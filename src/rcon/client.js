// TCP RCON client. Used as the primary transport for server-side MC commands,
// with mineflayer as the fallback (see src/mineflayer/commands.js).
//
// Why dual transport: RCON gives structured responses and doesn't depend on
// the bot account being online, but it's frequently unreachable on managed
// MC hosts. If RCON ever fails or isn't configured, calls transparently
// route through the in-game bot's chat.
//
// Backoff: after an RCON failure, we mark it "unavailable" for 60s so we
// don't pay a TCP-timeout latency on every command attempt during an outage.

import { Rcon } from 'rcon-client';
import { env } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const log = logger.child('rcon');

const BACKOFF_MS = 60_000;

let connection = null;
let connecting = null;
let unavailableUntil = 0;

export let lastSuccessfulCallAt = null;

function isConfigured() {
  return !!(env.rcon.host && env.rcon.password);
}

export function isRconAvailable() {
  if (!isConfigured()) return false;
  if (Date.now() < unavailableUntil) return false;
  return true;
}

function markUnavailable(reason) {
  unavailableUntil = Date.now() + BACKOFF_MS;
  if (connection) {
    try { connection.end().catch(() => {}); } catch { /* noop */ }
    connection = null;
  }
  log.warn(`RCON marked unavailable for ${BACKOFF_MS / 1000}s: ${reason}`);
}

async function connect() {
  if (!isConfigured()) {
    throw new Error('RCON not configured (RCON_HOST / RCON_PASSWORD missing).');
  }
  const r = new Rcon({
    host: env.rcon.host,
    port: env.rcon.port,
    password: env.rcon.password,
  });
  r.on('end',   () => { log.warn('rcon connection closed'); connection = null; });
  r.on('error', (err) => log.warn(`rcon error: ${err.message}`));
  await r.connect();
  log.info(`rcon connected to ${env.rcon.host}:${env.rcon.port}`);
  return r;
}

async function getConn() {
  if (connection) return connection;
  if (!connecting) {
    connecting = connect().finally(() => { connecting = null; });
  }
  connection = await connecting;
  return connection;
}

/**
 * Sends a raw command via RCON. Throws on any failure. Caller is responsible
 * for deciding whether to fall back to another transport.
 */
export async function rconSend(command) {
  if (Date.now() < unavailableUntil) {
    throw new Error('RCON in backoff window');
  }
  try {
    const c = await getConn();
    const resp = await c.send(command);
    lastSuccessfulCallAt = Date.now();
    return resp ?? '';
  } catch (e) {
    markUnavailable(e.message);
    throw e;
  }
}

/**
 * Boot-time probe. Returns 'ok' / 'unavailable' / 'unconfigured' for logging.
 */
export async function probeRcon() {
  if (!isConfigured()) return { status: 'unconfigured' };
  try {
    const resp = await rconSend('list');
    return { status: 'ok', response: String(resp).trim() };
  } catch (e) {
    return { status: 'unavailable', error: e.message };
  }
}

export function getRconLastSuccess() {
  return lastSuccessfulCallAt;
}

export async function rconClose() {
  if (connection) {
    try { await connection.end(); } catch { /* noop */ }
    connection = null;
  }
}
