// In-memory blocklist mirrored against the bot_blocklist Postgres table.
// `isBlocked(discordId)` is synchronous and very hot — it runs on every
// interaction + every modmail message — so we cache + mutate-through.
//
// Lifecycle:
//   initBlocklist()   - called once at startup, loads cache from DB
//   isBlocked(id)     - sync, reads cache
//   blockUser(...)    - DB upsert + cache update
//   unblockUser(...)  - DB delete + cache update

import { supabase } from '../db/client.js';
import { logger } from './logger.js';

const log = logger.child('blocklist');

// discord_id -> { blocked_at, blocked_by, reason }
const cache = new Map();
let inited = false;

export async function initBlocklist() {
  const { data, error } = await supabase.from('bot_blocklist').select('*');
  if (error) throw error;
  cache.clear();
  for (const row of data ?? []) {
    cache.set(row.discord_id, {
      blocked_at: row.blocked_at,
      blocked_by: row.blocked_by,
      reason:     row.reason,
    });
  }
  inited = true;
  log.info(`blocklist loaded: ${cache.size} entries`);
}

export function isBlocked(discordId) {
  if (!inited) return false; // fail-open during startup
  return cache.has(discordId);
}

export function getBlockEntry(discordId) {
  return cache.get(discordId) ?? null;
}

export async function blockUser({ discordId, blockedBy, reason }) {
  const row = {
    discord_id: discordId,
    blocked_by: blockedBy ?? null,
    reason:     reason ?? null,
  };
  const { error } = await supabase
    .from('bot_blocklist')
    .upsert(row, { onConflict: 'discord_id' });
  if (error) throw error;
  cache.set(discordId, { blocked_at: new Date().toISOString(), blocked_by: row.blocked_by, reason: row.reason });
  log.info(`blocked ${discordId} (by ${blockedBy}): ${reason ?? '(no reason)'}`);
}

export async function unblockUser(discordId) {
  const { error } = await supabase.from('bot_blocklist').delete().eq('discord_id', discordId);
  if (error) throw error;
  const existed = cache.delete(discordId);
  if (existed) log.info(`unblocked ${discordId}`);
  return existed;
}

export function listBlocked() {
  return [...cache.entries()].map(([discord_id, v]) => ({ discord_id, ...v }));
}
