// Sets a guild member's nickname to their MC display name. Used by the
// /verify post-link hook and by the /admin-sync-nicknames backfill command.
//
// Display-name rules:
//   - Strip Floodgate's leading "." so Bedrock users show as "Player" not ".Player".
//   - Discord caps nicknames at 32 characters; MC names are ≤16 so this never
//     truncates today, but the slice is defensive.
//
// Failure modes are logged but never thrown:
//   - Bot lacks "Manage Nicknames" permission → warn
//   - Target is the guild owner (Discord doesn't allow bots to rename owners) → warn
//   - Bot's highest role is below the target's highest role → warn
//   - Member not in guild → warn

import { env } from './config.js';
import { logger } from './logger.js';

const log = logger.child('nickname');

export function displayMcName(mcName) {
  return String(mcName ?? '').replace(/^\./, '').slice(0, 32);
}

export async function setNicknameToMc(discordClient, discordId, mcName) {
  if (!discordId || !mcName) return { ok: false, reason: 'missing args' };
  const nick = displayMcName(mcName);
  if (!nick) return { ok: false, reason: 'empty nick' };

  let guild;
  try { guild = await discordClient.guilds.fetch(env.discord.guildId); }
  catch (e) { log.warn(`guild fetch: ${e.message}`); return { ok: false, reason: e.message }; }

  let member;
  try { member = await guild.members.fetch({ user: discordId, force: true }); }
  catch (e) { log.warn(`member ${discordId} fetch: ${e.message}`); return { ok: false, reason: e.message }; }

  if (member.nickname === nick) return { ok: true, unchanged: true, nick };

  try {
    await member.setNickname(nick, 'auto-sync to MC username');
    log.info(`set nickname for ${discordId}: "${member.nickname ?? member.user.username}" → "${nick}"`);
    return { ok: true, nick };
  } catch (e) {
    // Guild owners can't be renamed by bots — Discord limitation, not a bug.
    const msg = e.message?.includes('owner') || e.code === 50013
      ? `${e.message} (bot lacks Manage Nicknames OR its role is below ${discordId}'s highest role OR ${discordId} is the guild owner)`
      : e.message;
    log.warn(`setNickname ${discordId} → ${nick}: ${msg}`);
    return { ok: false, reason: e.message };
  }
}
