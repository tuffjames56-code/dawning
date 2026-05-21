// Compat shim. The "RCON" name is retained so older imports keep compiling,
// but commands now flow through the in-game bot (src/mineflayer/commands.js)
// instead of a TCP RCON socket. Managed hosts (like TheGameHosting) don't
// expose RCON publicly, so the bot's OP account is the more portable path.
//
// If you ever want to flip back to real TCP RCON, restore this file from git
// history and the rest of the codebase will start using it again unchanged.

import { sendCommand } from '../mineflayer/commands.js';
import { logger } from '../utils/logger.js';

const log = logger.child('rcon-shim');

export let lastSuccessfulCallAt = null;

export async function rconSend(command) {
  const resp = await sendCommand(command);
  lastSuccessfulCallAt = Date.now();
  return resp ?? '';
}

export function getRconLastSuccess() {
  return lastSuccessfulCallAt;
}

export async function rconClose() {
  // No persistent TCP socket to close; the underlying transport is the
  // mineflayer bot, which has its own lifecycle.
  log.info('rconClose() called; nothing to do (mineflayer-backed transport)');
}
