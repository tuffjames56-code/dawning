// Bounty lifecycle. Same shape as the sponsor request module: each function
// owns DB transition + embed render + side-effects (RCON payout / refund,
// DMs) so the panel handlers, the in-game finalize path, and the expiry task
// all share the same surface.
//
// Lifecycle:
//   depositing → active     (postBounty after deposit session completes)
//   active     → completed  (markBountyCompleted, called from death listener)
//   completed  → completed  (claimBountyPayout, sets claimed_by + does RCON give)
//   active     → expired    (expireBounty, refunds items to poster)
//   any        → cancelled  (cancelBounty, refunds items to poster)

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import {
  getBounty,
  getBountyItems,
  getUserByDiscord,
  updateBountyFields,
  transitionBounty,
} from '../../db/queries.js';
import { env } from '../../utils/config.js';
import { getSetting } from '../settings/index.js';
import { mcGive, CommandValidationError } from '../../mineflayer/commands.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('bounty/actions');

// ----- embed -----

const STATE_COLORS = {
  depositing: 0xFEE75C,
  active:     0xED4245,
  completed:  0x57F287,
  expired:    0x95A5A6,
  cancelled:  0x95A5A6,
};

const STATE_TITLES = {
  depositing: '⏳ Bounty (depositing items...)',
  active:     '💰 Active Bounty',
  completed:  '🏁 Bounty Claimed',
  expired:    '⌛ Bounty Expired',
  cancelled:  '✖ Bounty Cancelled',
};

function itemsLine(items) {
  if (!items.length) return '_no items_';
  return items
    .map((i) => `• ${i.count}× \`${i.item_name ?? i.item_id ?? 'unknown'}\``)
    .join('\n');
}

export async function buildBountyEmbed(bounty) {
  const items = await getBountyItems(bounty.id);
  const display = String(bounty.target_mc_name ?? '?').replace(/^\./, '') || '?';
  const embed = new EmbedBuilder()
    .setColor(STATE_COLORS[bounty.status] ?? 0x000000)
    .setTitle(STATE_TITLES[bounty.status] ?? 'Bounty')
    .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(display)}/100`)
    .addFields(
      { name: 'Target',  value: `\`${display}\``, inline: true },
      { name: 'Posted by', value: bounty.poster_discord_id ? `<@${bounty.poster_discord_id}>` : '_unknown_', inline: true },
      { name: 'Rewards', value: itemsLine(items) },
    );

  if (bounty.status === 'active' && bounty.expires_at) {
    const unix = Math.floor(new Date(bounty.expires_at).getTime() / 1000);
    embed.addFields({ name: 'Expires', value: `<t:${unix}:R>` });
  }
  if (bounty.status === 'completed' && bounty.claimed_by_discord_id) {
    embed.addFields({ name: 'Claimed by', value: `<@${bounty.claimed_by_discord_id}>` });
  }
  embed.setFooter({ text: `Bounty #${bounty.id}` });
  return embed;
}

export function buildBountyComponents(bounty) {
  // Cancel is always visible to the poster (handler will re-check ownership).
  // Phase 3 keeps it simple: a single button row per state.
  const row = new ActionRowBuilder();
  if (bounty.status === 'active') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`bounty:cancel:${bounty.id}`)
        .setLabel('Cancel Bounty')
        .setStyle(ButtonStyle.Danger),
    );
  } else if (bounty.status === 'completed' && !bounty.claimed_by_discord_id) {
    // Edge: completion happens via in-game kill, but if payout is pending
    // (e.g. killer not yet linked) show a Claim button on the embed too.
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`bounty:claim:${bounty.id}`)
        .setLabel('Claim (link required)')
        .setStyle(ButtonStyle.Primary),
    );
  }
  return row.components.length ? [row] : [];
}

// ----- channel helpers -----

async function postOrEditBountyMessage(discordClient, bounty) {
  const channelId = env.discord.bountyChannelId;
  if (!channelId) {
    log.warn('BOUNTY_CHANNEL_ID is not set; skipping bounty embed post.');
    return null;
  }
  const channel = await discordClient.channels.fetch(channelId);
  const embed = await buildBountyEmbed(bounty);
  const components = buildBountyComponents(bounty);

  if (bounty.message_id) {
    try {
      const msg = await channel.messages.fetch(bounty.message_id);
      await msg.edit({ embeds: [embed], components });
      return bounty.message_id;
    } catch (e) {
      log.warn(`edit bounty msg ${bounty.message_id} failed: ${e.message}; reposting`);
    }
  }
  const content = bounty.status === 'active' && env.discord.bountyRoleId
    ? `<@&${env.discord.bountyRoleId}>`
    : null;
  const msg = await channel.send({ content, embeds: [embed], components, allowedMentions: { roles: env.discord.bountyRoleId ? [env.discord.bountyRoleId] : [] } });
  await updateBountyFields(bounty.id, { message_id: msg.id, posted_at: new Date().toISOString() });
  return msg.id;
}

// ----- lifecycle -----

/**
 * Move a 'depositing' bounty to 'active' and post the embed.
 * Called by the deposit-session finalizer.
 */
export async function activateBounty({ bountyId, discordClient }) {
  const claim = await transitionBounty(bountyId, {
    expectedStatus: 'depositing',
    newStatus: 'active',
  });
  if (!claim) return { ok: false, reason: 'not_depositing' };
  await postOrEditBountyMessage(discordClient, claim);
  log.info(`bounty #${bountyId} activated`);
  return { ok: true, bounty: claim };
}

/**
 * Death listener / admin handle. Marks completed; payout happens via
 * claimBountyPayout (link-gated).
 */
export async function markBountyCompleted({ bountyId, killerDiscordId = null, discordClient }) {
  const claim = await transitionBounty(bountyId, {
    expectedStatus: 'active',
    newStatus: 'completed',
    patch: { claimed_by_discord_id: killerDiscordId, claimed_at: new Date().toISOString() },
  });
  if (!claim) return { ok: false, reason: 'not_active' };

  await postOrEditBountyMessage(discordClient, claim);

  if (killerDiscordId) {
    return claimBountyPayout({ bountyId, killerDiscordId, discordClient });
  }

  log.info(`bounty #${bountyId} completed (unclaimed - killer not linked)`);
  return { ok: true, bounty: claim, awaitingClaim: true };
}

/**
 * Give the bounty items to the claimer via RCON. Caller has already verified
 * the killer is linked. Updates the embed (status stays 'completed').
 */
export async function claimBountyPayout({ bountyId, killerDiscordId, discordClient }) {
  const bounty = await getBounty(bountyId);
  if (!bounty || bounty.status !== 'completed') {
    return { ok: false, reason: 'not_completed' };
  }
  if (bounty.claimed_by_discord_id && bounty.claimed_by_discord_id !== killerDiscordId) {
    return { ok: false, reason: 'already_claimed' };
  }

  // Look up MC name. We need a linked user to give items via /give.
  // Caller passes killer's discord_id; we resolve mc_name from the users table.
  const killer = await getUserByDiscord(killerDiscordId);
  if (!killer?.mc_name || killer.status === 'none') {
    // Mark them as the assigned claimer so they can link + come back later.
    await updateBountyFields(bountyId, { claimed_by_discord_id: killerDiscordId });
    return { ok: false, reason: 'killer_not_linked' };
  }

  const items = await getBountyItems(bountyId);
  await giveItemsTo(killer.mc_name, items);

  await updateBountyFields(bountyId, {
    claimed_by_discord_id: killerDiscordId,
    claimed_at:            bounty.claimed_at ?? new Date().toISOString(),
  });
  const refreshed = await getBounty(bountyId);
  await postOrEditBountyMessage(discordClient, refreshed);

  await tryDM(discordClient, killerDiscordId, `🏆 You claimed bounty #${bountyId}. Your reward has been delivered in-game.`);
  log.info(`bounty #${bountyId} paid out to ${killerDiscordId} (${killer.mc_name})`);
  return { ok: true, bounty: refreshed };
}

/**
 * Cancel + refund. Allowed only by the poster, or by admin override (actor).
 * If status is 'depositing' (no items collected yet) the refund is a no-op.
 */
export async function cancelBounty({ bountyId, actorDiscordId, discordClient, adminOverride = false }) {
  const bounty = await getBounty(bountyId);
  if (!bounty) return { ok: false, reason: 'not_found' };
  if (!['depositing', 'active'].includes(bounty.status)) {
    return { ok: false, reason: `cannot_cancel_${bounty.status}` };
  }
  if (!adminOverride && bounty.poster_discord_id !== actorDiscordId) {
    return { ok: false, reason: 'not_poster' };
  }

  const items = await getBountyItems(bountyId);
  const claim = await transitionBounty(bountyId, {
    expectedStatus: bounty.status,
    newStatus: 'cancelled',
  });
  if (!claim) return { ok: false, reason: 'race' };

  // Refund items if the bounty was active (i.e. items had been collected).
  if (bounty.status === 'active') await refundItemsToPoster(bounty, items, discordClient);

  await postOrEditBountyMessage(discordClient, claim);
  log.info(`bounty #${bountyId} cancelled by ${actorDiscordId} (admin=${adminOverride})`);
  return { ok: true, bounty: claim };
}

/**
 * Expiry path (scheduler). Refunds items to the poster.
 */
export async function expireBounty({ bountyId, discordClient }) {
  const bounty = await getBounty(bountyId);
  if (!bounty || bounty.status !== 'active') return { ok: false, reason: 'not_active' };

  const items = await getBountyItems(bountyId);
  const claim = await transitionBounty(bountyId, {
    expectedStatus: 'active',
    newStatus: 'expired',
  });
  if (!claim) return { ok: false, reason: 'race' };

  await refundItemsToPoster(bounty, items, discordClient);
  await postOrEditBountyMessage(discordClient, claim);
  log.info(`bounty #${bountyId} expired`);
  return { ok: true, bounty: claim };
}

// ----- item give / refund -----

// Hands out items to a player via the validated mcGive wrapper.
// Returns { ok, failures: [{item_id, count, response}] }.
async function giveItemsTo(mcName, items) {
  const failures = [];
  for (const it of items) {
    const rawId = it.item_id || it.item_name;
    if (!rawId) continue;
    const count = it.count ?? 1;
    try {
      const result = await mcGive(mcName, rawId, count, it.nbt ?? null);
      if (result.ok) {
        log.info(`gave ${mcName}: ${count}× ${rawId}`);
      } else {
        log.warn(`give ${mcName} did not confirm: ${result.response}`);
        failures.push({ item_id: rawId, count, response: result.response });
      }
    } catch (e) {
      const tag = e instanceof CommandValidationError ? 'rejected by validator' : 'threw';
      log.warn(`give ${mcName} ${tag}: ${e.message}`);
      failures.push({ item_id: rawId, count, response: e.message });
    }
  }
  return { ok: failures.length === 0, failures };
}

async function refundItemsToPoster(bounty, items, discordClient) {
  const poster = bounty.poster_discord_id ? await getUserByDiscord(bounty.poster_discord_id) : null;
  if (!poster?.mc_name) {
    log.warn(`bounty #${bounty.id}: poster has no MC name; skipping refund.`);
    await tryDM(discordClient, bounty.poster_discord_id,
      `Your bounty #${bounty.id} was cancelled but I couldn't refund — no MC name on file. Ping an admin.`);
    return;
  }
  const itemList = items.map((i) => `${i.count ?? 1}× ${i.item_id ?? i.item_name}`).join(', ') || 'nothing';
  const { ok, failures } = await giveItemsTo(poster.mc_name, items);

  if (ok) {
    await tryDM(discordClient, bounty.poster_discord_id,
      `Your bounty #${bounty.id} was cancelled. Refunded: ${itemList}. Check your inventory in-game.`);
  } else {
    const failList = failures.map((f) => `${f.count}× ${f.item_id} (${f.response})`).join('; ');
    log.error(`bounty #${bounty.id} refund FAILED for ${poster.mc_name}: ${failList}`);
    await tryDM(discordClient, bounty.poster_discord_id,
      `⚠ Your bounty #${bounty.id} was cancelled but the refund \`/give\` failed:\n` +
      `\`\`\`${failList}\`\`\`\n` +
      `Make sure you're online in-game, then ping an admin to re-issue: \`${itemList}\`.`);
  }
}

async function tryDM(discordClient, discordId, content) {
  if (!discordId || !getSetting('send_link_dms')) return;
  try {
    const u = await discordClient.users.fetch(discordId);
    await u.send(content);
  } catch (e) { log.warn(`DM ${discordId}: ${e.message}`); }
}
