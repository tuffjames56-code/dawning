// Deposit session orchestrator. The poster:
//   1. Clicks Place Bounty in the panel + picks duration/item, then submits a
//      modal with target name + amount; the panel declares the EXPECTED reward
//      ({ itemId, count }) and calls startDepositSession with it.
//   2. Gets an ephemeral reply telling them to run `/tpa <bot>` in-game.
//   3. Runs /tpa; the bot accepts; TPA brings them to the bot's coords.
//   4. Drops the declared items on the ground; mineflayer picks them up
//      automatically. The deposit is only accepted if the picked-up items
//      MATCH the declaration (item id + count exactly).
//   5. Poster types `done` to finalise or `cancel` to abort. The session is
//      also auto-cancelled if the poster logs out, dies, walks too far, or
//      sits idle past bounty_deposit_timeout_minutes.

import { mc } from '../../mineflayer/bot.js';
import { mcReadPosition, mcTeleport } from '../../mineflayer/commands.js';
import {
  createDepositSession,
  updateDepositSession,
  addBountyItems,
  updateBountyFields,
  getUserByMcName,
} from '../../db/queries.js';
import { supabase } from '../../db/client.js';
import { activateBounty } from './actions.js';
import { getSetting } from '../settings/index.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../utils/config.js';

const log = logger.child('bounty/deposit');

// Rate limit for the "you need to place a bounty first" whisper, keyed by
// mc name. Without this, a player spamming /tpa would get spammed back.
const TPA_WHISPER_COOLDOWN_MS = 60_000;
const lastUnknownTpaWhisperAt = new Map();

async function tryDmDiscord(discordClient, discordId, content) {
  if (!discordClient || !discordId || !getSetting('send_link_dms')) return;
  try {
    const u = await discordClient.users.fetch(discordId);
    await u.send(content);
  } catch (e) { log.warn(`DM ${discordId}: ${e.message}`); }
}

// In-memory map for fast lookup keyed by mc name. Mirrors the DB row's
// status field; reloaded from DB on bot restart (declared reward is lost
// on restart, but the in-flight session can still be cancelled cleanly).
//
// Shape: {
//   id, bountyId, mcName, status,
//   savedCoords?, lastSeen,
//   declaredReward?: { itemId, count },
//   collected: Map<itemKey, { id, name, count, nbt }>   // items the bot picked
//                                                        // up that we credited to
//                                                        // the poster (proximity-
//                                                        // checked at pickup time)
// }
const sessions = new Map();

// ----- TPA chat parsing -----

// SimpleTPA on the owner's server emits:
//   "<user> wants to teleport to you!"
const TPA_REQUEST_RE = /^\s*([A-Za-z0-9_.]{1,32})\s+wants?\s+to\s+teleport\s+to\s+you/i;

function parseTpaRequester(message) {
  const m = TPA_REQUEST_RE.exec(message ?? '');
  return m ? m[1] : null;
}

// Vanilla death-message catch (1.20+). Tightened so a bare "<name> was X"
// doesn't false-positive on "<name> was kicked", "was given", "was promoted",
// etc. -- each branch requires a death-specific verb phrase.
const DEATH_NAME_RE = new RegExp(
  '^\\s*([A-Za-z0-9_.]{1,32})\\s+(?:' +
    'was\\s+(?:slain|killed|shot|murdered|sniped|fireballed|stung|squashed|squished|pricked|impaled|skewered|crystallized|electrocuted|crushed|smashed|frozen|withered|drowned|burned|blown\\s+up|knocked|struck|thrown|cramming)' +
    '|died(?:\\s+from|\\s*$|\\s+because)' +
    '|fell\\s+(?:from|out\\s+of|off|too\\s+far|into)' +
    '|went\\s+up\\s+in\\s+flames' +
    '|blew\\s+up' +
    '|tried\\s+to\\s+swim' +
    '|hit\\s+the\\s+ground' +
    '|burned\\s+to\\s+death' +
    '|froze\\s+to\\s+death' +
    '|starved\\s+to\\s+death' +
    '|suffocated' +
    '|withered\\s+away' +
    '|walked\\s+into\\s+(?:fire|cactus|lava)' +
    '|drowned' +
  ')',
  'i',
);
function parseDeathName(message) {
  const m = DEATH_NAME_RE.exec(message ?? '');
  return m ? m[1] : null;
}

// ----- item attribution helpers -----

// Mineflayer stuffs dropped-item info into entity.metadata, but the exact
// shape varies by protocol version:
//   prismarine-item:    { name: 'diamond',     count: 1,  displayName, nbt }
//   1.20.5+ component:  { itemId: 'minecraft:diamond', itemCount: 1, components }
//   numeric protocol:   { itemId: 264, itemCount: 1, nbtData }
// Plus some mineflayer builds expose it directly on entity.item.
function extractItemFromEntity(entity) {
  if (!entity) return null;
  if (entity.item) {
    const n = normalizeItem(entity.item);
    if (n) return n;
  }
  if (!entity.metadata) return null;
  const values = Array.isArray(entity.metadata)
    ? entity.metadata.filter((v) => v !== undefined && v !== null)
    : Object.values(entity.metadata);
  for (const v of values) {
    const n = normalizeItem(v);
    if (n) return n;
  }
  return null;
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // prismarine-item Item: { name, count, displayName, nbt }
  if (typeof raw.name === 'string' && typeof raw.count === 'number' && raw.count > 0) {
    return raw;
  }
  // 1.20.5+ component / older { itemId, itemCount }
  const idField = raw.itemId ?? raw.id;
  const countField = raw.itemCount ?? raw.count;
  if ((typeof idField === 'string' || typeof idField === 'number') && typeof countField === 'number' && countField > 0) {
    return {
      name: typeof idField === 'string' ? idField.replace(/^minecraft:/, '') : String(idField),
      count: countField,
      displayName: null,
      nbt: raw.components ?? raw.nbtData ?? raw.nbt ?? null,
    };
  }
  return null;
}

// Cache item info per entity id while items exist in the world. Populated on
// entity spawn AND on metadata updates (some protocol versions ship the slot
// in a follow-up packet). Drained on pickup or despawn.
const itemMetaCache = new Map();

// Distance from the bot to the closest non-bot player. Used to identify who
// the most likely thrower of a just-collected item is. We assume the closest
// player to the item at the moment the bot picks it up was the source.
function findClosestPlayer(bot, pos) {
  let closest = null;
  let bestDist = 5; // tossed items don't fly far, so 5 blocks is generous
  for (const p of Object.values(bot.players ?? {})) {
    if (!p?.entity || p.username === bot.username) continue;
    const d = pos.distanceTo(p.entity.position);
    if (d < bestDist) { closest = p.username; bestDist = d; }
  }
  return closest ? { username: closest, dist: bestDist } : null;
}

function collectedToArray(map) {
  return [...map.values()];
}

// Strips a "minecraft:" namespace prefix for comparison (some plugins return
// the bare item id; mineflayer's `name` is `diamond`, not `minecraft:diamond`).
function bareItemName(id) {
  return id.includes(':') ? id.split(':').slice(1).join(':') : id;
}

// Wrappers around the validated mineflayer command helpers.
async function readPlayerCoords(mcName) {
  try { return await mcReadPosition(mcName); }
  catch (e) { log.warn(`readPlayerCoords ${mcName}: ${e.message}`); return null; }
}

async function tpHome(mcName, coords) {
  if (!coords) {
    log.warn(`tpHome ${mcName}: no saved coords; leaving them at the bot`);
    return false;
  }
  try {
    const result = await mcTeleport(mcName, coords.x, coords.y, coords.z, coords.dim ?? null);
    return result.ok;
  } catch (e) {
    log.warn(`tpHome ${mcName} failed: ${e.message}`);
    return false;
  }
}

// ----- public API -----

export async function startDepositSession({ bounty, posterMcName, declaredReward = null }) {
  if (!env.mc.username) {
    throw new Error('MC_BOT_USERNAME not configured; bounty deposit needs the bot in-game.');
  }
  const sessionRow = await createDepositSession({
    userDiscordId:   bounty.poster_discord_id,
    userMcName:      posterMcName,
    pendingBountyId: bounty.id,
  });

  sessions.set(posterMcName, {
    id: sessionRow.id,
    bountyId: bounty.id,
    mcName: posterMcName,
    status: 'awaiting_tpa',
    savedCoords: null,
    lastSeen: Date.now(),
    declaredReward,
    collected: new Map(),
  });

  log.info(`deposit session #${sessionRow.id} started for ${posterMcName} (bounty #${bounty.id}; reward=${declaredReward ? `${declaredReward.count}× ${declaredReward.itemId}` : 'free-form'})`);
  return sessionRow;
}

// ----- mineflayer wiring -----

export function registerDepositFlow(discordClient) {
  rehydrateSessions().catch((e) => log.warn(`rehydrate sessions: ${e.message}`));

  // System messages (TPA notifications, death lines) come through 'message'.
  mc.on('message', ({ message, bot }) => {
    handleIncomingTpa({ message, bot }).catch((e) => log.warn(`tpa msg: ${e.message}`));
    handlePosterDeath({ message, bot, discordClient }).catch((e) => log.warn(`death msg: ${e.message}`));
  });

  // Player chat for the explicit done/cancel keywords.
  mc.on('chat', ({ username, message, bot }) => {
    handleDepositSignal({ username, message, bot, discordClient }).catch((e) => log.warn(`chat signal: ${e.message}`));
  });
  mc.on('whisper', ({ username, message, bot }) => {
    handleDepositSignal({ username, message, bot, discordClient }).catch((e) => log.warn(`whisper signal: ${e.message}`));
  });

  // Per-reconnect bot listeners.
  mc.on('ready', ({ bot }) => {
    bot.on('playerLeft', (player) => {
      const session = sessions.get(player?.username);
      if (!session) return;
      log.info(`deposit session #${session.id}: ${player.username} left the game; cancelling`);
      cancelDeposit({ session, bot, discordClient, reason: 'logout' })
        .catch((e) => log.warn(`cancel on playerLeft: ${e.message}`));
    });

    // Cache the parsed Item the moment a dropped-item entity becomes visible.
    // The slot info usually rides the spawn packet, but on some versions it
    // comes in a follow-up entity_metadata packet — entityUpdate catches that.
    bot.on('entitySpawn', (entity) => {
      if (entity?.name !== 'item') return;
      const item = extractItemFromEntity(entity);
      if (item) itemMetaCache.set(entity.id, item);
    });
    bot.on('entityUpdate', (entity) => {
      if (entity?.name !== 'item') return;
      if (itemMetaCache.has(entity.id)) return;
      const item = extractItemFromEntity(entity);
      if (item) itemMetaCache.set(entity.id, item);
    });
    bot.on('entityGone', (entity) => {
      itemMetaCache.delete(entity?.id);
    });

    // playerCollect fires for ANY player picking up ANY item. We only care
    // about pickups by the bot itself, and we only credit them to the closest
    // non-bot player at pickup time IF that player has an active session.
    // Random players dropping junk near the bot don't get counted toward
    // someone else's deposit.
    bot.on('playerCollect', (collector, collected) => {
      if (!collector || collector !== bot.entity) return;
      try {
        creditPickupToSession({ bot, collected });
      } catch (e) {
        log.warn(`playerCollect handler: ${e.message}`);
      }
    });
  });
}

function creditPickupToSession({ bot, collected }) {
  if (!collected?.position) return;
  const closest = findClosestPlayer(bot, collected.position);
  if (!closest) return;
  const session = sessions.get(closest.username);
  if (!session || session.status !== 'awaiting_items') return;

  // Cache hit first (populated at entity spawn/update). Fallback to
  // re-extracting from the just-collected entity (sometimes metadata is
  // present on the entity at pickup time even when spawn missed it).
  const cached = itemMetaCache.get(collected.id);
  itemMetaCache.delete(collected.id);
  const item = cached ?? extractItemFromEntity(collected);

  if (!item) {
    log.warn(`deposit #${session.id}: pickup from ${closest.username} but couldn't parse item metadata. Diagnostic dump follows.`);
    try {
      const dump = {
        entityId:   collected.id,
        name:       collected.name,
        type:       collected.type,
        objectType: collected.objectType,
        hasItemProp: collected.item != null,
        itemPreview: collected.item ? safePreview(collected.item) : null,
        metadataKeys: collected.metadata
          ? (Array.isArray(collected.metadata) ? collected.metadata.map((v, i) => v == null ? null : i).filter(Boolean) : Object.keys(collected.metadata))
          : [],
        metadataPreview: collected.metadata
          ? Object.entries(collected.metadata).slice(0, 6).map(([k, v]) => `${k}=${safePreview(v)}`)
          : [],
      };
      log.warn(`  ${JSON.stringify(dump).slice(0, 800)}`);
    } catch (e) { log.warn(`  dump failed: ${e.message}`); }
    return;
  }

  const itemKey = `${item.name}|${item.nbt ? JSON.stringify(item.nbt) : ''}`;
  const entry = session.collected.get(itemKey) ?? {
    id:    item.name,
    name:  item.displayName ?? item.name,
    count: 0,
    nbt:   null,
  };
  entry.count += item.count;
  session.collected.set(itemKey, entry);
  session.lastSeen = Date.now();

  log.info(`deposit #${session.id}: ${closest.username} dropped ${item.count}× ${item.name} (total ${entry.count}× this item)`);
}

function safePreview(v) {
  if (v == null) return String(v);
  if (typeof v !== 'object') return `${typeof v}:${String(v).slice(0, 40)}`;
  try {
    const keys = Object.keys(v).slice(0, 6);
    return `{${keys.map((k) => `${k}:${typeof v[k]}`).join(',')}}`;
  } catch { return '[unprintable]'; }
}

async function rehydrateSessions() {
  const { data, error } = await supabase
    .from('deposit_sessions')
    .select('*')
    .in('status', ['awaiting_tpa', 'awaiting_items']);
  if (error) { log.warn(`rehydrate query failed: ${error.message}`); return; }
  for (const row of data ?? []) {
    sessions.set(row.user_mc_name, {
      id: row.id,
      bountyId: row.pending_bounty_id,
      mcName: row.user_mc_name,
      status: row.status,
      savedCoords: row.saved_x !== null
        ? { x: row.saved_x, y: row.saved_y, z: row.saved_z, dim: row.saved_dimension }
        : null,
      lastSeen: Date.now(),
      declaredReward: null, // not persisted across restart - validation step is skipped
      collected: new Map(), // empty on restart - items in bot inventory pre-restart are lost
    });
  }
  log.info(`rehydrated ${sessions.size} in-flight deposit sessions`);
}

async function handleIncomingTpa({ message, bot }) {
  const requester = parseTpaRequester(message);
  if (!requester) return;
  const session = sessions.get(requester);
  if (!session || session.status !== 'awaiting_tpa') {
    // No matching session. Whisper back (rate-limited) so the player knows
    // why the bot isn't accepting — common case: they died/cancelled and
    // forgot to re-place the bounty in Discord.
    const last = lastUnknownTpaWhisperAt.get(requester) ?? 0;
    if (Date.now() - last > TPA_WHISPER_COOLDOWN_MS) {
      lastUnknownTpaWhisperAt.set(requester, Date.now());
      bot.chat(`/msg ${requester} I don't have a bounty placement for you. Place one in Discord first, then /tpa me.`);
    }
    return;
  }

  // Snapshot the requester's pre-TPA coords FIRST. After /tpaccept they're
  // teleported to us and we'd have no way to know where they came from.
  const savedCoords = await readPlayerCoords(requester);
  if (savedCoords) {
    log.info(`deposit session #${session.id}: saved pre-tpa coords (${savedCoords.x.toFixed(1)}, ${savedCoords.y.toFixed(1)}, ${savedCoords.z.toFixed(1)} in ${savedCoords.dim ?? 'unknown'})`);
  } else {
    log.warn(`deposit session #${session.id}: could not read pre-tpa coords; tp-home will be skipped`);
  }

  bot.chat('/tpaccept');

  session.status = 'awaiting_items';
  session.collected = new Map(); // clear in case of re-entry
  session.savedCoords = savedCoords;
  session.lastSeen = Date.now();

  await updateDepositSession(session.id, {
    status: 'awaiting_items',
    saved_x: session.savedCoords?.x ?? null,
    saved_y: session.savedCoords?.y ?? null,
    saved_z: session.savedCoords?.z ?? null,
    saved_dimension: session.savedCoords?.dim ?? null,
  });

  const declared = session.declaredReward;
  const dropMsg = declared
    ? `Drop ${declared.count}× ${declared.itemId} near me, then say "done". Say "cancel" to abort.`
    : `Drop the reward items near me, then say "done". Say "cancel" to abort.`;
  bot.chat(`/msg ${requester} ${dropMsg}`);
  log.info(`deposit session #${session.id}: ${requester} arrived; awaiting items`);
}

async function handleDepositSignal({ username, message, bot, discordClient }) {
  const session = sessions.get(username);
  if (!session || session.status !== 'awaiting_items') return;
  const text = String(message ?? '').trim().toLowerCase();
  if (text !== 'done' && text !== 'cancel') return;

  // Belt + suspenders: the chat speaker name MUST match a real online player
  // entity near the bot. Stops a malicious-format chat line from finalizing
  // someone else's session.
  const playerEntity = bot.players?.[username]?.entity;
  if (!playerEntity || !bot.entity) {
    log.warn(`deposit #${session.id}: got "${text}" from ${username} but they're not visible to bot; ignoring`);
    return;
  }
  const distLimit = getSetting('bounty_deposit_distance_blocks');
  const dist = bot.entity.position.distanceTo(playerEntity.position);
  if (dist > distLimit) {
    log.warn(`deposit #${session.id}: got "${text}" from ${username} but they're ${dist.toFixed(1)}b away; ignoring`);
    return;
  }

  session.lastSeen = Date.now();
  if (text === 'done')   return finalizeDeposit({ session, bot, discordClient });
  if (text === 'cancel') return cancelDeposit({ session, bot, discordClient, reason: 'user-cancel' });
}

async function handlePosterDeath({ message, bot, discordClient }) {
  const name = parseDeathName(message);
  if (!name) return;
  const session = sessions.get(name);
  if (!session) return;
  if (!['awaiting_tpa', 'awaiting_items'].includes(session.status)) return;
  log.info(`deposit session #${session.id}: ${name} died; cancelling`);
  await cancelDeposit({ session, bot, discordClient, reason: 'died' });
}

async function finalizeDeposit({ session, bot, discordClient }) {
  const diff = collectedToArray(session.collected);
  if (diff.length === 0) {
    bot.chat(`/msg ${session.mcName} I haven't picked up any items from you yet. Drop them closer to me, then try "done" again.`);
    return;
  }

  // Declared-reward validation. If the panel told us exactly what should be
  // deposited, refuse anything else. (Only counts items YOU threw — random
  // players' tossed junk near the bot doesn't satisfy your declaration.)
  if (session.declaredReward) {
    const { itemId, count } = session.declaredReward;
    const expectedBare = bareItemName(itemId);
    const matching = diff.find((d) => d.id === expectedBare || d.id === itemId);
    const extras   = diff.filter((d) => d !== matching);

    if (!matching || matching.count < count) {
      bot.chat(`/msg ${session.mcName} I need ${count}× ${itemId}; I only saw ${matching?.count ?? 0} from you. Drop more.`);
      return;
    }
    if (extras.length > 0 || matching.count > count) {
      bot.chat(`/msg ${session.mcName} You dropped extra items beyond ${count}× ${itemId}. Pick them back up or say "cancel" to start over.`);
      return;
    }
  }

  try {
    await addBountyItems(session.bountyId, diff);
    await updateDepositSession(session.id, { status: 'complete' });
    const tpedBack = await tpHome(session.mcName, session.savedCoords);

    const result = await activateBounty({ bountyId: session.bountyId, discordClient });
    if (!result.ok) {
      log.warn(`bounty #${session.bountyId} could not activate: ${result.reason}`);
      bot.chat(`/msg ${session.mcName} Deposit recorded but bounty activation failed (${result.reason}). Ping an admin.`);
    } else {
      const tail = tpedBack ? ' Sent you back to where you started.' : '';
      bot.chat(`/msg ${session.mcName} ✓ Bounty #${session.bountyId} is now live.${tail}`);
    }
  } catch (e) {
    log.error('finalizeDeposit failed:', e);
    bot.chat(`/msg ${session.mcName} Something went wrong recording the deposit. Items kept; ping an admin.`);
    return;
  } finally {
    sessions.delete(session.mcName);
  }
}

async function cancelDeposit({ session, bot, discordClient, reason = 'cancel' }) {
  // Toss whatever the bot picked up so items aren't lost (skip if we won't
  // be able to deliver them anyway, like when the poster logged out).
  if (reason !== 'logout' && reason !== 'died') {
    try {
      if (bot?.inventory) {
        for (const it of bot.inventory.items()) {
          try { await bot.tossStack(it); } catch { /* noop */ }
        }
      }
    } catch (e) { log.warn(`toss on cancel: ${e.message}`); }
  }

  await updateDepositSession(session.id, { status: 'cancelled' });
  await updateBountyFields(session.bountyId, { status: 'cancelled' });

  // Look up discord_id once for the DM.
  const user = await getUserByMcName(session.mcName).catch(() => null);
  const discordId = user?.discord_id;

  // In-game whispers (only useful if they're online + near the bot).
  if (reason === 'user-cancel' || reason === 'cancel') {
    await tpHome(session.mcName, session.savedCoords);
    if (bot) bot.chat(`/msg ${session.mcName} ✓ Bounty deposit cancelled. Items tossed back near me.`);
  } else if (reason === 'distance') {
    if (bot) bot.chat(`/msg ${session.mcName} You walked too far from me; deposit cancelled. Anything I picked up was tossed.`);
  } else if (reason === 'died') {
    log.info(`deposit session #${session.id}: cancelled on death; items lost with the deceased`);
  } else if (reason === 'logout') {
    log.info(`deposit session #${session.id}: cancelled on logout`);
  }

  // Discord DM so they know what happened even if they're offline / respawning.
  const dmText =
    reason === 'died'        ? `Your bounty placement (#${session.bountyId}) was cancelled because you died during deposit. Re-open the bounty panel to try again.`
    : reason === 'logout'    ? `Your bounty placement (#${session.bountyId}) was cancelled because you logged out before depositing. Re-open the bounty panel to try again.`
    : reason === 'distance'  ? `Your bounty placement (#${session.bountyId}) was cancelled because you walked away from the bot. Re-open the bounty panel to try again.`
    : reason === 'user-cancel' ? `Your bounty placement (#${session.bountyId}) was cancelled at your request.`
    : `Your bounty placement (#${session.bountyId}) was cancelled.`;
  await tryDmDiscord(discordClient, discordId, dmText);

  sessions.delete(session.mcName);
}

// Scheduler sweep: timeout fallback + distance check.
export async function sweepExpiredDeposits({ discordClient = null } = {}) {
  const timeoutMs       = getSetting('bounty_deposit_timeout_minutes') * 60 * 1000;
  const maxDistance     = getSetting('bounty_deposit_distance_blocks');
  const now             = Date.now();
  const bot             = mc.bot;
  let reaped = 0;
  let walkedAway = 0;

  for (const [mcName, s] of sessions) {
    if (now - s.lastSeen >= timeoutMs) {
      log.info(`reaping stale deposit #${s.id} (mc=${mcName}, idle ${(now - s.lastSeen) / 1000 | 0}s)`);
      try { await cancelDeposit({ session: s, bot, discordClient, reason: 'distance' }); }
      catch (e) { log.warn(`reap ${s.id}: ${e.message}`); }
      reaped++;
      continue;
    }

    if (s.status !== 'awaiting_items' || !bot?.entity || !bot.players) continue;
    const playerEntity = bot.players[mcName]?.entity;
    if (!playerEntity) {
      if (now - s.lastSeen < 10_000) continue;
      log.info(`deposit #${s.id}: ${mcName} not visible; cancelling`);
      try { await cancelDeposit({ session: s, bot, discordClient, reason: 'distance' }); }
      catch (e) { log.warn(`cancel-no-entity ${s.id}: ${e.message}`); }
      walkedAway++;
      continue;
    }
    const dist = bot.entity.position.distanceTo(playerEntity.position);
    if (dist > maxDistance) {
      log.info(`deposit #${s.id}: ${mcName} ${dist.toFixed(1)}b away (>${maxDistance}); cancelling`);
      try { await cancelDeposit({ session: s, bot, discordClient, reason: 'distance' }); }
      catch (e) { log.warn(`cancel-far ${s.id}: ${e.message}`); }
      walkedAway++;
    }
  }
  return { reaped, walked_away: walkedAway };
}

export function getActiveSessionByMcName(mcName) { return sessions.get(mcName) ?? null; }
