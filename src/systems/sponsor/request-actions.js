// Sponsor-request lifecycle: create, sponsor, reject, expire. These functions
// own the embed rendering + DB transitions + DMs so the panel handlers AND
// the background expiry task share the same path.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SnowflakeUtil,
} from 'discord.js';
import {
  createSponsorRequest,
  getSponsorRequest,
  setSponsorRequestMessageId,
  claimSponsorRequest,
  getUserByDiscord,
  updateUserFields,
} from '../../db/queries.js';
import { applySponsorship } from './actions.js';
import { env } from '../../utils/config.js';
import { getSetting } from '../settings/index.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('sponsor/requests');

// ---------- embed builder ----------

const COLORS = {
  pending:   0xE67E22, // orange
  sponsored: 0x57F287, // green
  rejected:  0xED4245, // red
  expired:   0x95A5A6, // gray
};

const TITLES = {
  pending:   '🙋 Sponsor Request',
  sponsored: '✅ Sponsored',
  rejected:  '❌ Rejected',
  expired:   '⏰ Expired',
};

function accountAgeDays(discordId) {
  try {
    const created = Number(SnowflakeUtil.deconstruct(discordId).timestamp);
    return Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000));
  } catch { return null; }
}

export function buildRequestEmbed({ request, requesterUser }) {
  const state = request.status;
  const display = String(requesterUser?.mc_name ?? '').replace(/^\./, '') || '?';
  const age = accountAgeDays(request.requester_discord_id);

  const embed = new EmbedBuilder()
    .setColor(COLORS[state] ?? 0x000000)
    .setTitle(TITLES[state] ?? 'Request')
    .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(display === '?' ? 'steve' : display)}/100`)
    .addFields(
      { name: 'Minecraft', value: `\`${display}\``, inline: true },
      { name: 'Discord',   value: `<@${request.requester_discord_id}>${age !== null ? ` (account ${age}d old)` : ''}`, inline: true },
      { name: 'Reason',    value: (request.reason || '_none_').slice(0, 1024) },
      { name: 'References', value: (request.applicant_references || 'None').slice(0, 1024) },
    );

  if (request.expires_at && state === 'pending') {
    const unix = Math.floor(new Date(request.expires_at).getTime() / 1000);
    embed.addFields({ name: 'Expires', value: `<t:${unix}:R>` });
  }
  if (state === 'sponsored' && request.responded_by_discord_id) {
    embed.addFields({ name: 'Sponsored by', value: `<@${request.responded_by_discord_id}>` });
  }
  if (state === 'rejected' && request.responded_by_discord_id) {
    embed.addFields({ name: 'Rejected by', value: `<@${request.responded_by_discord_id}>` });
    if (request.rejection_reason) {
      embed.addFields({ name: 'Reason', value: request.rejection_reason.slice(0, 1024) });
    }
  }

  embed.setFooter({ text: `Request ID: ${request.id}` });
  return embed;
}

export function buildRequestComponents(request) {
  if (request.status !== 'pending') return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`req:sponsor:${request.id}`).setLabel('Sponsor This Person').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`req:reject:${request.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ---------- helpers ----------

async function editRequestMessage(discordClient, request, requesterUser) {
  if (!request.message_id) return;
  const channelId = env.discord.sponsorRequestsChannelId;
  if (!channelId) return;
  try {
    const channel = await discordClient.channels.fetch(channelId);
    const message = await channel.messages.fetch(request.message_id);
    await message.edit({
      embeds: [buildRequestEmbed({ request, requesterUser })],
      components: buildRequestComponents(request),
    });
  } catch (e) {
    log.warn(`edit request message ${request.message_id} failed: ${e.message}`);
  }
}

async function tryDM(discordClient, discordId, content) {
  if (!discordId || !getSetting('send_link_dms')) return;
  try {
    const u = await discordClient.users.fetch(discordId);
    await u.send(content);
  } catch (e) { log.warn(`DM ${discordId}: ${e.message}`); }
}

function setRequestEndedCooldown(discordId) {
  return updateUserFields(discordId, { last_request_ended_at: new Date().toISOString() });
}

// ---------- lifecycle ----------

/**
 * Create a request + post its private-channel embed. Caller has already
 * validated eligibility (status='linked', no active request, not on cooldown).
 *
 * Returns the created request row.
 */
export async function createRequest({ requesterUser, reason, applicantReferences, discordClient }) {
  if (!env.discord.sponsorRequestsChannelId) {
    throw new Error('SPONSOR_REQUESTS_CHANNEL_ID is not configured.');
  }

  const expiresAt = new Date(Date.now() + getSetting('request_expiry_days') * 24 * 60 * 60 * 1000);

  const request = await createSponsorRequest({
    requesterDiscordId: requesterUser.discord_id,
    reason,
    applicantReferences,
    expiresAt,
  });

  // Post embed to private channel; save message_id back so later transitions
  // can edit it.
  try {
    const channel = await discordClient.channels.fetch(env.discord.sponsorRequestsChannelId);
    const message = await channel.send({
      embeds: [buildRequestEmbed({ request, requesterUser })],
      components: buildRequestComponents(request),
    });
    await setSponsorRequestMessageId(request.id, message.id);
    request.message_id = message.id;
  } catch (e) {
    log.error(`failed to post request embed for #${request.id}:`, e);
    // The request row exists; admin can find it via /admin-audit-log etc.
  }

  log.info(`request created: #${request.id} by ${requesterUser.discord_id}`);
  return request;
}

/**
 * Fulfil a request by sponsoring the requester. Atomically claims the request
 * so only one trusted member's click wins. Returns:
 *   { ok: true, request }                       - claimed + sponsored
 *   { ok: false, reason: 'already_resolved' }   - someone else got there first
 */
export async function sponsorFromRequest({ requestId, sponsorId, discordClient, actor }) {
  const existing = await getSponsorRequest(requestId);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.status !== 'pending') return { ok: false, reason: 'already_resolved' };

  const claim = await claimSponsorRequest(requestId, { newStatus: 'sponsored', respondedBy: sponsorId });
  if (!claim) return { ok: false, reason: 'already_resolved' };

  // The user being sponsored may have changed state in the meantime.
  const requester = await getUserByDiscord(claim.requester_discord_id);
  if (!requester || requester.status !== 'linked') {
    // Revert claim - the requester isn't sponsorable anymore.
    await claimSponsorRequest(requestId, { newStatus: 'pending' }); // best-effort; may no-op
    return { ok: false, reason: requester ? `requester is ${requester.status}` : 'requester_missing' };
  }

  await applySponsorship({
    sponsorId,
    sponseeId: requester.discord_id,
    sponseeMcName: requester.mc_name,
    sponseeMcUuid: requester.mc_uuid,
    discordClient,
    actor,
    source: 'panel',
  });

  await editRequestMessage(discordClient, claim, requester);
  await tryDM(discordClient, requester.discord_id,
    `✅ You've been sponsored by <@${sponsorId}>! Join the main server.`);

  log.info(`request #${requestId} sponsored by ${sponsorId}`);
  return { ok: true, request: claim };
}

/**
 * Admin reject. Sets last_request_ended_at on the requester (cooldown) + DMs.
 */
export async function rejectRequest({ requestId, adminId, rejectionReason = null, discordClient }) {
  const claim = await claimSponsorRequest(requestId, { newStatus: 'rejected', respondedBy: adminId, rejectionReason });
  if (!claim) return { ok: false, reason: 'already_resolved' };

  const requester = await getUserByDiscord(claim.requester_discord_id);
  await setRequestEndedCooldown(claim.requester_discord_id);
  await editRequestMessage(discordClient, claim, requester);

  const reasonLine = rejectionReason ? `\n\nReason: ${rejectionReason}` : '';
  await tryDM(discordClient, claim.requester_discord_id,
    `Your sponsor request was declined.${reasonLine}`);

  log.info(`request #${requestId} rejected by ${adminId}`);
  return { ok: true, request: claim };
}

/**
 * Background-task path. Marks expired, edits embed, DMs requester, sets cooldown.
 */
export async function expireRequest({ request, discordClient }) {
  const claim = await claimSponsorRequest(request.id, { newStatus: 'expired', respondedBy: null });
  if (!claim) return { ok: false, reason: 'already_resolved' };

  const requester = await getUserByDiscord(claim.requester_discord_id);
  await setRequestEndedCooldown(claim.requester_discord_id);
  await editRequestMessage(discordClient, claim, requester);

  const cooldownHours = getSetting('request_rejection_cooldown_hours');
  await tryDM(discordClient, claim.requester_discord_id,
    `Your sponsor request expired without a response. You can submit a new one in ${cooldownHours} hours.`);

  log.info(`request #${request.id} expired`);
  return { ok: true, request: claim };
}
