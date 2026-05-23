// IP verification for MC joins.
//
// The verify-mod on the main server calls POST /join-check with the
// player's UUID + IP at login time. This module decides whether to allow
// or block, and DMs the user when a new IP needs approval.
//
// Rules:
//   - Unknown UUID         -> approve (let MC's whitelist handle it)
//   - User has no approved IPs yet -> save this one + approve (first join)
//   - This IP is approved  -> approve
//   - Otherwise            -> set pending, DM the user, deny

import { ButtonBuilder, ActionRowBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import {
  getUserByMcUuid,
  addApprovedIp,
  setPendingIp,
} from '../../db/queries.js';
import { getSetting } from '../settings/index.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('security/ip-check');

// Encodes/decodes IPs for use inside Discord component custom_ids. Discord
// limits custom_id to 100 chars and IPv6 has colons that collide with our
// `:`-delimited customId scheme, so we base64url them.
export function encIp(ip) {
  return Buffer.from(String(ip), 'utf8').toString('base64url');
}
export function decIp(b64) {
  return Buffer.from(String(b64), 'base64url').toString('utf8');
}

function approvalPayload({ discordUserId, ip, mcName }) {
  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('🔐 New login location')
    .setDescription(
      `Your Minecraft account \`${mcName ?? '?'}\` just tried to log in from a new IP address.\n\n` +
      `**IP:** \`${ip}\`\n\n` +
      `Was this you? If yes, click **Allow**. If you didn't try to log in, click **Deny** and the IP stays blocked.`,
    )
    .setFooter({ text: 'You can revoke an approved IP later via /admin-ip remove' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ip:approve:${encIp(ip)}`).setLabel('Allow this IP').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ip:deny:${encIp(ip)}`).setLabel('Deny (it wasn\'t me)').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

export async function evaluateJoin({ mcUuid, ip, discordClient }) {
  if (!getSetting('ip_security_enabled')) return { approve: true, reason: 'feature disabled' };
  if (!mcUuid || !ip) return { approve: true, reason: 'missing fields, failing open' };

  const user = await getUserByMcUuid(mcUuid).catch(() => null);
  if (!user || !user.discord_id || user.status === 'none') {
    // Not linked. The MC whitelist + main server will handle them; we don't
    // gate unlinked users.
    return { approve: true, reason: 'not linked' };
  }
  const approved = Array.isArray(user.approved_ips) ? user.approved_ips : [];

  // Trust the first IP we ever see for a user. Otherwise the first legitimate
  // login after deploying this feature would always get blocked.
  if (approved.length === 0) {
    await addApprovedIp(user.discord_id, ip).catch((e) => log.warn(`first-IP save: ${e.message}`));
    log.info(`first IP recorded for ${user.discord_id} (${user.mc_name}): ${ip}`);
    return { approve: true, reason: 'first-known IP, auto-approved' };
  }

  if (approved.includes(ip)) {
    return { approve: true, reason: 'already approved' };
  }

  // New IP. Store as pending and DM the user.
  await setPendingIp(user.discord_id, ip).catch((e) => log.warn(`pending IP save: ${e.message}`));
  try {
    const u = await discordClient.users.fetch(user.discord_id);
    await u.send(approvalPayload({ discordUserId: user.discord_id, ip, mcName: user.mc_name }));
    log.info(`new-IP DM sent to ${user.discord_id} (${user.mc_name}): ${ip}`);
  } catch (e) {
    log.warn(`new-IP DM failed for ${user.discord_id}: ${e.message}`);
    // If the DM fails (closed DMs etc.), we still deny — better safe than sorry.
  }
  return {
    approve: false,
    reason: 'pending approval',
    kick_message: 'Your account has been temporarily blocked for security. Check your DMs to approve this login.',
  };
}
