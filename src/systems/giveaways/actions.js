// Giveaway lifecycle owner. Shared by the slash commands AND the scheduler.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import {
  createGiveaway,
  setGiveawayMessageId,
  getGiveaway,
  addGiveawayEntry,
  getGiveawayEntry,
  listGiveawayEntries,
  endGiveaway,
  cancelGiveaway,
} from '../../db/queries.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('giveaways');

export function buildGiveawayEmbed(g, entryCount) {
  const color = g.status === 'active' ? 0x57F287 : g.status === 'ended' ? 0xFEE75C : 0x95A5A6;
  const title = g.status === 'active' ? '🎉 Giveaway!' : g.status === 'ended' ? '🏁 Giveaway ended' : '✖ Giveaway cancelled';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(
      `**Prize:** ${g.prize}\n` +
      `**Winners:** ${g.winners_count}\n` +
      `**Host:** ${g.host_discord_id ? `<@${g.host_discord_id}>` : '?'}\n` +
      (g.status === 'active'
        ? `**Ends:** <t:${Math.floor(new Date(g.ends_at).getTime() / 1000)}:R>\n` +
          `**Entries:** ${entryCount}\n\n` +
          `Click the button below to enter.`
        : `**Ended:** <t:${Math.floor(new Date(g.ended_at ?? g.ends_at).getTime() / 1000)}:R>\n` +
          `**Entries:** ${entryCount}\n` +
          (g.winner_ids?.length
            ? `**Winners:** ${g.winner_ids.map((id) => `<@${id}>`).join(', ')}`
            : '**Winners:** _(none — not enough entries)_')),
    )
    .setFooter({ text: `Giveaway #${g.id}` });
  return embed;
}

export function buildGiveawayComponents(g) {
  if (g.status !== 'active') return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${g.id}`)
      .setLabel('Enter')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Primary),
  )];
}

async function refreshGiveawayMessage(discordClient, g) {
  if (!g.message_id) return;
  try {
    const channel = await discordClient.channels.fetch(g.channel_id);
    const msg = await channel.messages.fetch(g.message_id);
    const entries = await listGiveawayEntries(g.id);
    await msg.edit({ embeds: [buildGiveawayEmbed(g, entries.length)], components: buildGiveawayComponents(g) });
  } catch (e) { log.warn(`refresh giveaway ${g.id} message: ${e.message}`); }
}

// ----- lifecycle -----

export async function startGiveaway({ discordClient, channel, hostDiscordId, prize, durationMs, winnersCount }) {
  if (!prize) throw new Error('prize is required');
  if (!Number.isInteger(winnersCount) || winnersCount < 1 || winnersCount > 50) {
    throw new Error('winnersCount must be an integer between 1 and 50');
  }
  if (!Number.isInteger(durationMs) || durationMs < 10_000) {
    throw new Error('duration must be at least 10 seconds');
  }

  const endsAt = new Date(Date.now() + durationMs);
  const g = await createGiveaway({
    channelId: channel.id,
    hostDiscordId,
    prize,
    winnersCount,
    endsAt,
  });

  const msg = await channel.send({
    embeds: [buildGiveawayEmbed(g, 0)],
    components: buildGiveawayComponents(g),
  });
  await setGiveawayMessageId(g.id, msg.id);
  g.message_id = msg.id;

  log.info(`giveaway #${g.id} started in ${channel.id}: "${prize}" × ${winnersCount}, ends ${endsAt.toISOString()}`);
  return g;
}

export async function recordEntry(giveawayId, discordId, { discordClient = null } = {}) {
  const g = await getGiveaway(giveawayId);
  if (!g) return { ok: false, reason: 'not_found' };
  if (g.status !== 'active') return { ok: false, reason: 'closed' };
  if (new Date(g.ends_at).getTime() < Date.now()) return { ok: false, reason: 'closed' };

  // Already-entered detection. The upsert below would silently no-op, so
  // we have to check first to give the user real feedback.
  const existing = await getGiveawayEntry(giveawayId, discordId);
  if (existing) return { ok: false, reason: 'already_entered' };

  await addGiveawayEntry(giveawayId, discordId);

  // Refresh the embed so the entry count visibly ticks up. Best-effort:
  // if it fails (rate limit, missing perms), the entry is still recorded.
  if (discordClient) {
    refreshGiveawayMessage(discordClient, g).catch((e) => log.warn(`refresh after entry: ${e.message}`));
  }
  return { ok: true };
}

// Picks `count` distinct entrants without replacement. Returns winner ids
// (may be fewer than requested if entries < count).
function pickWinners(entries, count) {
  const pool = [...entries];
  const winners = [];
  while (pool.length > 0 && winners.length < count) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return winners;
}

export async function drawGiveaway({ discordClient, giveawayId, force = false }) {
  const g = await getGiveaway(giveawayId);
  if (!g) return { ok: false, reason: 'not_found' };
  if (g.status !== 'active') return { ok: false, reason: 'already_ended' };
  if (!force && new Date(g.ends_at).getTime() > Date.now()) {
    return { ok: false, reason: 'not_ended_yet' };
  }
  const entries = await listGiveawayEntries(giveawayId);
  const winners = pickWinners(entries, g.winners_count);
  const ended = await endGiveaway(giveawayId, { winnerIds: winners });
  if (!ended) return { ok: false, reason: 'race' };

  await refreshGiveawayMessage(discordClient, ended);

  // Announce in-channel.
  try {
    const channel = await discordClient.channels.fetch(g.channel_id);
    if (winners.length === 0) {
      await channel.send(`🎉 Giveaway #${g.id} ended with no entries.`);
    } else {
      await channel.send(`🎉 Giveaway #${g.id} **${g.prize}** — Congrats ${winners.map((id) => `<@${id}>`).join(', ')}!`);
    }
  } catch (e) { log.warn(`announce giveaway ${g.id}: ${e.message}`); }

  log.info(`giveaway #${g.id} drawn: winners=${winners.join(',') || '(none)'} from ${entries.length} entries`);
  return { ok: true, giveaway: ended, winners };
}

export async function rerollGiveaway({ discordClient, giveawayId }) {
  const g = await getGiveaway(giveawayId);
  if (!g) return { ok: false, reason: 'not_found' };
  if (g.status !== 'ended') return { ok: false, reason: 'not_ended' };
  const entries = await listGiveawayEntries(giveawayId);
  // Re-roll: exclude the original winners.
  const pool = entries.filter((id) => !(g.winner_ids ?? []).includes(id));
  if (pool.length === 0) return { ok: false, reason: 'no_eligible_entries' };
  const newWinner = pickWinners(pool, 1);

  try {
    const channel = await discordClient.channels.fetch(g.channel_id);
    await channel.send(`🎉 Reroll for giveaway #${g.id} **${g.prize}** — Congrats <@${newWinner[0]}>!`);
  } catch (e) { log.warn(`reroll announce ${g.id}: ${e.message}`); }
  log.info(`giveaway #${g.id} reroll: winner=${newWinner[0]}`);
  return { ok: true, winner: newWinner[0] };
}

export async function adminCancelGiveaway({ discordClient, giveawayId }) {
  const cancelled = await cancelGiveaway(giveawayId);
  if (!cancelled) return { ok: false, reason: 'not_found_or_inactive' };
  await refreshGiveawayMessage(discordClient, cancelled);
  log.info(`giveaway #${giveawayId} cancelled`);
  return { ok: true, giveaway: cancelled };
}
