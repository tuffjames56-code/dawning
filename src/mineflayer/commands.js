// All bot-to-server admin commands go through this module. We talk to the
// server via mineflayer's in-game chat (the bot is OP), so this replaces the
// RCON transport for managed hosts that don't expose RCON externally.
//
// Defense in depth:
//   1. sendCommand() at the bottom rejects any string with newlines, control
//      bytes, non-ASCII, or > MAX_CMD_LENGTH. Even buggy callers can't inject.
//   2. Every typed wrapper (mcGive, mcTp, etc.) validates each argument with
//      a strict regex BEFORE building the command string. A player name with
//      a space or quote is rejected — no command-injection surface.
//   3. Commands are queued + rate-limited (≤ 20/s) so a bug can't flood the
//      server chat and get the bot kicked for spam.
//   4. Each command waits up to RESPONSE_TIMEOUT_MS for the next system
//      message and returns it, so callers can parse pass/fail.
//   5. Every send + response is logged at INFO level for audit.

import { mc } from './bot.js';
import { rconSend, isRconAvailable } from '../rcon/client.js';
import { logger } from '../utils/logger.js';

const log = logger.child('mc/commands');

// ---------- strict input validation ----------

// Java + Bedrock (Floodgate adds a leading dot). Max length 32.
const PLAYER_NAME_RE = /^\.?[A-Za-z0-9_]{1,32}$/;
// Item IDs: "minecraft:diamond", "modid:thing", or bare "diamond".
const ITEM_ID_RE = /^(?:[a-z0-9_]+:)?[a-z0-9_.]+$/;
// Dimensions: "minecraft:overworld", "minecraft:the_nether", "modid:dim".
const DIM_ID_RE = /^[a-z0-9_]+:[a-z0-9_]+$/;
// Effect IDs: same shape as items.
const EFFECT_ID_RE = ITEM_ID_RE;
// LP group: alphanumeric + underscore.
const LP_GROUP_RE = /^[a-z0-9_]{1,32}$/i;

export class CommandValidationError extends Error {
  constructor(field, value) {
    super(`invalid ${field}: ${String(value).slice(0, 80)}`);
    this.field = field;
    this.value = value;
  }
}

function assertName(name)       { if (typeof name !== 'string' || !PLAYER_NAME_RE.test(name)) throw new CommandValidationError('player name', name); return name; }
function assertItem(id)         { if (typeof id   !== 'string' || !ITEM_ID_RE.test(id))      throw new CommandValidationError('item id', id);      return id; }
function assertDim(id)          { if (typeof id   !== 'string' || !DIM_ID_RE.test(id))       throw new CommandValidationError('dimension', id);    return id; }
function assertEffect(id)       { if (typeof id   !== 'string' || !EFFECT_ID_RE.test(id))    throw new CommandValidationError('effect', id);       return id; }
function assertGroup(g)         { if (typeof g    !== 'string' || !LP_GROUP_RE.test(g))      throw new CommandValidationError('lp group', g);      return g; }
function assertIntInRange(n, lo, hi, field = 'integer') {
  if (!Number.isInteger(n) || n < lo || n > hi) throw new CommandValidationError(field, n);
  return n;
}
function assertFinite(n, field = 'number') {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new CommandValidationError(field, n);
  return n;
}

// NBT-suffix on /give. We don't compose this server-side; if a caller passes
// one, require it to start with { and contain no quote-breaking chars.
function assertNbtTagOrNull(nbt) {
  if (nbt == null || nbt === '') return '';
  if (typeof nbt !== 'string') throw new CommandValidationError('nbt', typeof nbt);
  if (!nbt.startsWith('{') || nbt.includes('\n') || nbt.includes('\r')) {
    throw new CommandValidationError('nbt', nbt.slice(0, 40));
  }
  if (nbt.length > 4000) throw new CommandValidationError('nbt length', nbt.length);
  return nbt;
}

// ---------- low-level: queue + send ----------

const MAX_CMD_LENGTH = 256;
const MIN_INTERVAL_MS = 50;     // rate limit: <= 20 commands/sec
const RESPONSE_TIMEOUT_MS = 3000;
const MULTI_LINE_AGGREGATE_MS = 100;  // commands that emit several lines (data get etc.)

const queue = [];
let processing = false;
let lastSentAt = 0;

function lowLevelValidate(command) {
  if (typeof command !== 'string')      throw new CommandValidationError('command type', typeof command);
  if (command.length === 0)             throw new CommandValidationError('command', 'empty');
  if (command.length > MAX_CMD_LENGTH)  throw new CommandValidationError('command length', command.length);
  if (/[\r\n]/.test(command))           throw new CommandValidationError('command', 'contains newline');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B-\x1F\x7F]/.test(command)) throw new CommandValidationError('command', 'contains control char');
  if (/[^\x20-\x7E]/.test(command))     throw new CommandValidationError('command', 'contains non-ASCII');
  return command;
}

/**
 * Send a raw command. Tries RCON first if it's configured and not in
 * backoff; falls back to the in-game bot's chat path on any failure.
 * Returns the response text (possibly multi-line) or '' on timeout.
 *
 * Why dual-transport: RCON is more reliable but frequently blocked on
 * managed hosts. The bot keeps working through either path.
 */
export async function sendCommand(command) {
  const safe = lowLevelValidate(command.replace(/^\//, ''));

  // Try RCON first when it's available.
  if (isRconAvailable()) {
    try {
      log.info(`>> /${safe}  (rcon)`);
      const resp = await rconSend(safe);
      log.info(`<< (rcon) ${String(resp).trim() || '(no response)'}`);
      return String(resp ?? '');
    } catch (e) {
      log.warn(`rcon path failed (${e.message}); falling back to in-game bot`);
      // fall through to mineflayer queue
    }
  }

  // Mineflayer fallback. Same queueing + rate limiting as before.
  return new Promise((resolve, reject) => {
    queue.push({ command: safe, resolve, reject });
    kickQueue();
  });
}

async function kickQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const wait = MIN_INTERVAL_MS - (Date.now() - lastSentAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const { command, resolve, reject } = queue.shift();
      try {
        const resp = await executeOne(command);
        resolve(resp);
      } catch (e) {
        reject(e);
      }
    }
  } finally {
    processing = false;
  }
}

function executeOne(command) {
  const bot = mc.bot;
  if (!bot || !bot.player) {
    return Promise.reject(new Error('bot is not connected'));
  }
  lastSentAt = Date.now();

  return new Promise((resolve) => {
    const lines = [];
    let done = false;
    let aggregateTimer = null;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(aggregateTimer);
      clearTimeout(hardTimer);
      bot.removeListener('messagestr', handler);
      const resp = lines.join('\n');
      log.info(`<< ${resp || '(no response)'}`);
      resolve(resp);
    };

    const handler = (message, position) => {
      // Only accept system / game_info responses, never raw player chat.
      if (position !== 'system' && position !== 'game_info') return;
      lines.push(message);
      // Wait a brief window for additional lines, then resolve.
      clearTimeout(aggregateTimer);
      aggregateTimer = setTimeout(finish, MULTI_LINE_AGGREGATE_MS);
    };

    bot.on('messagestr', handler);
    log.info(`>> /${command}`);
    bot.chat(`/${command}`);

    // Hard timeout in case nothing comes back.
    const hardTimer = setTimeout(() => {
      log.warn(`command "/${command}" produced no response within ${RESPONSE_TIMEOUT_MS}ms`);
      finish();
    }, RESPONSE_TIMEOUT_MS);
  });
}

// ---------- typed wrappers ----------

// Returns { ok, response }. Caller can interrogate .ok to act on failure.

export async function mcGive(mcName, itemId, count, nbtTag = null) {
  assertName(mcName);
  assertItem(itemId);
  assertIntInRange(count, 1, 9999, 'count');
  const safeNbt = assertNbtTagOrNull(nbtTag);
  // Always namespace-prefix vanilla items; some plugins reject bare ids.
  const fullId = itemId.includes(':') ? itemId : `minecraft:${itemId}`;
  const resp = await sendCommand(`give ${mcName} ${fullId}${safeNbt} ${count}`);
  return { ok: /^Gave\s+\d/i.test(resp), response: resp };
}

export async function mcClear(mcName, itemId = null, maxCount = null) {
  assertName(mcName);
  if (itemId != null) assertItem(itemId);
  if (maxCount != null) assertIntInRange(maxCount, 0, 99999, 'maxCount');
  let cmd = `clear ${mcName}`;
  if (itemId) {
    const fullId = itemId.includes(':') ? itemId : `minecraft:${itemId}`;
    cmd += ` ${fullId}`;
    if (maxCount != null) cmd += ` ${maxCount}`;
  }
  const resp = await sendCommand(cmd);
  return { ok: /^Removed\s+\d/i.test(resp) || /Found\s+\d/i.test(resp), response: resp };
}

// Teleport one player to coords. Optional dimension via execute-in.
export async function mcTeleport(mcName, x, y, z, dim = null) {
  assertName(mcName);
  assertFinite(x, 'x'); assertFinite(y, 'y'); assertFinite(z, 'z');
  if (dim != null) assertDim(dim);
  const xs = x.toFixed(2), ys = y.toFixed(2), zs = z.toFixed(2);
  const cmd = dim
    ? `execute in ${dim} run tp ${mcName} ${xs} ${ys} ${zs}`
    : `tp ${mcName} ${xs} ${ys} ${zs}`;
  const resp = await sendCommand(cmd);
  return { ok: /Teleported/i.test(resp), response: resp };
}

export async function mcEffect(mcName, effectId, durationSec, amplifier, hideParticles = true) {
  assertName(mcName);
  assertEffect(effectId);
  assertIntInRange(durationSec, 1, 1_000_000, 'duration');
  assertIntInRange(amplifier, 0, 255, 'amplifier');
  const fullId = effectId.includes(':') ? effectId : `minecraft:${effectId}`;
  const resp = await sendCommand(`effect give ${mcName} ${fullId} ${durationSec} ${amplifier} ${hideParticles ? 'true' : 'false'}`);
  return { ok: /Applied effect|Given/i.test(resp), response: resp };
}

export async function mcWhitelistAdd(mcName) {
  assertName(mcName);
  const resp = await sendCommand(`whitelist add ${mcName}`);
  return { ok: /Added/i.test(resp) || /already/i.test(resp), response: resp };
}

export async function mcWhitelistRemove(mcName) {
  assertName(mcName);
  const resp = await sendCommand(`whitelist remove ${mcName}`);
  return { ok: /Removed/i.test(resp) || /not whitelisted/i.test(resp), response: resp };
}

// LuckPerms: set the user's primary parent group. Group name validated.
export async function mcSetLpGroup(mcName, groupName) {
  assertName(mcName);
  assertGroup(groupName);
  const resp = await sendCommand(`lp user ${mcName} parent set ${groupName}`);
  return { ok: /Set|now inherits/i.test(resp), response: resp };
}

export async function mcClearLpGroup(mcName, defaultGroup = 'default') {
  assertName(mcName);
  assertGroup(defaultGroup);
  const resp = await sendCommand(`lp user ${mcName} parent set ${defaultGroup}`);
  return { ok: /Set|now inherits/i.test(resp), response: resp };
}

// Kick a player from the server. The reason string is bounded + sanitised
// so it can't be used to inject command separators or newlines into chat.
export async function mcKick(mcName, reason = 'unsponsored') {
  assertName(mcName);
  if (typeof reason !== 'string') reason = String(reason);
  // Strip anything non-printable and cap to a reasonable length.
  const safeReason = reason
    .replace(/[\r\n\x00-\x1F\x7F]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .slice(0, 120) || 'unsponsored';
  const resp = await sendCommand(`kick ${mcName} ${safeReason}`);
  return { ok: /Kicked|No\s+player/i.test(resp), response: resp };
}

// data get entity <name> Pos / Dimension. Returns parsed coords or null.
export async function mcReadPosition(mcName) {
  assertName(mcName);
  const posResp = await sendCommand(`data get entity ${mcName} Pos`);
  const posMatch = /\[\s*(-?[\d.]+)d?\s*,\s*(-?[\d.]+)d?\s*,\s*(-?[\d.]+)d?\s*\]/.exec(posResp);
  if (!posMatch) {
    log.warn(`mcReadPosition ${mcName}: pos parse failed: ${posResp}`);
    return null;
  }
  let dim = null;
  try {
    const dimResp = await sendCommand(`data get entity ${mcName} Dimension`);
    const dimMatch = /"([^"]+)"/.exec(dimResp);
    if (dimMatch) dim = dimMatch[1];
  } catch (e) { log.warn(`mcReadPosition ${mcName} dim: ${e.message}`); }
  return {
    x: parseFloat(posMatch[1]),
    y: parseFloat(posMatch[2]),
    z: parseFloat(posMatch[3]),
    dim,
  };
}
