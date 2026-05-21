// Shared user-mutation helpers used by the admin panel buttons AND the
// /admin-user-* slash commands. Keeps both surfaces in sync.

import { EmbedBuilder } from 'discord.js';
import { getUserByDiscord, updateUserFields, adminForceUnlinkRow } from '../../db/queries.js';
import { logSponsorAction } from '../../db/queries.js';
import { env } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('admin/users');

const VALID_STATUSES = ['none', 'linked', 'sponsee', 'trusted', 'banned'];

export function renderUserEmbed(user) {
  if (!user) {
    return new EmbedBuilder().setColor(0xED4245).setTitle('User not found').setDescription('No record matched.');
  }
  const display = String(user.mc_name ?? '').replace(/^\./, '') || '_none_';
  const fields = [
    { name: 'Discord',  value: `<@${user.discord_id}> (\`${user.discord_id}\`)`, inline: false },
    { name: 'MC name',  value: user.mc_name ? `\`${display}\`` + (user.mc_name.startsWith('.') ? ' _(Bedrock)_' : '') : '_unlinked_', inline: true },
    { name: 'MC UUID',  value: user.mc_uuid ? `\`${user.mc_uuid}\`` : '_none_', inline: true },
    { name: 'Status',   value: user.status, inline: true },
    { name: 'Sponsor',  value: user.sponsor_discord_id ? `<@${user.sponsor_discord_id}>` : '_none_', inline: true },
    { name: 'Sponsored at', value: user.sponsored_at ? new Date(user.sponsored_at).toISOString() : '_none_', inline: true },
    { name: 'Strikes',  value: String(user.strikes ?? 0), inline: true },
    { name: 'next_link_at',    value: user.next_link_at ? new Date(user.next_link_at).toISOString() : '_none_', inline: true },
    { name: 'next_sponsor_at', value: user.next_sponsor_at ? new Date(user.next_sponsor_at).toISOString() : '_none_', inline: true },
  ];
  return new EmbedBuilder().setColor(0x5865F2).setTitle(`👥 ${display || user.discord_id}`).addFields(fields);
}

export async function setUserStatus(discordId, status, actor) {
  if (!VALID_STATUSES.includes(status)) throw new Error(`invalid status: ${status}`);
  const before = await getUserByDiscord(discordId);
  if (!before) throw new Error(`no user record for ${discordId}`);
  await updateUserFields(discordId, { status });
  await logSponsorAction({
    sponsorDiscordId: before.sponsor_discord_id ?? null,
    sponseeDiscordId: discordId,
    action: 'admin_set_status',
    notes: `actor=${actor}, ${before.status} -> ${status}`,
  });
  log.info(`admin status: ${discordId} ${before.status} -> ${status} by ${actor}`);
  return { before: before.status, after: status };
}

export async function clearCooldowns(discordId, actor) {
  await updateUserFields(discordId, { next_link_at: null, next_sponsor_at: null });
  await logSponsorAction({
    sponseeDiscordId: discordId,
    action: 'admin_clear_cooldowns',
    notes: `actor=${actor}`,
  });
  log.info(`admin clear cooldowns: ${discordId} by ${actor}`);
}

export async function resetStrikes(discordId, actor) {
  const before = await getUserByDiscord(discordId);
  await updateUserFields(discordId, { strikes: 0, last_strike_decay_at: null });
  await logSponsorAction({
    sponsorDiscordId: discordId,
    action: 'admin_reset_strikes',
    notes: `actor=${actor}, prev=${before?.strikes ?? 0}`,
  });
  log.info(`admin reset strikes: ${discordId} (was ${before?.strikes ?? 0}) by ${actor}`);
}

export async function forceUnlinkRaw(discordId, actor) {
  const before = await getUserByDiscord(discordId);
  await adminForceUnlinkRow(discordId);
  await logSponsorAction({
    sponseeDiscordId: discordId,
    action: 'admin_force_unlink',
    notes: `actor=${actor}, prior=${JSON.stringify({ status: before?.status, mc: before?.mc_name })}`,
  });
  log.info(`admin raw unlink: ${discordId} by ${actor}`);
}

export async function adminDM(discordClient, discordId, message, actor) {
  const user = await discordClient.users.fetch(discordId);
  await user.send(message);
  await logSponsorAction({
    sponseeDiscordId: discordId,
    action: 'admin_dm',
    notes: `actor=${actor}, len=${message.length}`,
  });
  log.info(`admin DM: -> ${discordId} by ${actor} (${message.length} chars)`);
}
