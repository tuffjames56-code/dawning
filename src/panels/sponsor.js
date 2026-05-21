// User-facing sponsor panel posted in SPONSOR_CHANNEL_ID via /sponsor-setup.
//
// customId map:
//   sponsor:open-modal               -> button -> opens "Sponsor Someone" modal
//   sponsor:apply-submit             -> modal submit
//   sponsor:my-sponsee               -> button -> ephemeral sponsee summary
//   sponsor:my-strikes               -> button -> ephemeral strike summary
//   sponsor:remove                   -> button -> sponsee picker (or direct confirm)
//   sponsor:remove-pick              -> select submit
//   sponsor:remove-confirm:<id>      -> button
//   sponsor:remove-cancel            -> button

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { buttonHandlers, modalHandlers, selectMenuHandlers } from './registry.js';
import {
  getUserByDiscord,
  getUserByMcName,
  getActiveSponseesOf,
  getSponsorLogs,
} from '../db/queries.js';
import { canSponsor } from '../systems/sponsor/canSponsor.js';
import { applySponsorship, removeSponsorship } from '../systems/sponsor/actions.js';
import { getSetting } from '../systems/settings/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('panels/sponsor');

// ----- panel embed -----

export function buildSponsorPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('🤝 Sponsor Panel')
    .setDescription(
      `Trusted members: sponsor a linked player to get them on the main server.\n\n` +
      `**Sponsor Someone** — whitelists a linked player and assigns them to you.\n` +
      `**My Sponsee** — current sponsorship + days to auto-promote.\n` +
      `**Remove Sponsorship** — end a sponsorship you hold (24h cooldown applies).\n` +
      `**My Strikes** — strike count + recent history.`,
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sponsor:open-modal').setLabel('Sponsor Someone').setEmoji('🤝').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('sponsor:my-sponsee').setLabel('My Sponsee').setEmoji('👤').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('sponsor:remove').setLabel('Remove Sponsorship').setEmoji('🚪').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('sponsor:my-strikes').setLabel('My Strikes').setEmoji('⚠️').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

// ----- Sponsor Someone -----

buttonHandlers.set('sponsor:open-modal', async (interaction) => {
  // Pre-check so we don't open a modal the user will fail. Modal must open
  // synchronously off the button click, so this check happens BEFORE the
  // modal display (no defer).
  const c = await canSponsor(interaction.user.id);
  if (!c.allowed) {
    await interaction.reply({ content: c.reason, flags: MessageFlags.Ephemeral });
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId('sponsor:apply-submit')
    .setTitle('Sponsor Someone')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('mc_name')
          .setLabel('Target MC username')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32),
      ),
    );
  await interaction.showModal(modal);
});

modalHandlers.set('sponsor:apply-submit', async (interaction) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Re-check state - user could have lost trusted, hit cooldown, etc.
  const c = await canSponsor(interaction.user.id);
  if (!c.allowed) {
    await interaction.editReply(c.reason);
    return;
  }

  const mcName = interaction.fields.getTextInputValue('mc_name').trim();
  const target = await getUserByMcName(mcName);

  if (!target) {
    await interaction.editReply(
      `\`${mcName}\` isn't linked yet. They need to run \`/link\` in Discord first.`,
    );
    return;
  }
  if (target.status === 'banned') {
    await interaction.editReply(`\`${target.mc_name}\` is banned and can't be sponsored.`);
    return;
  }
  if (target.status !== 'linked') {
    await interaction.editReply(
      `\`${target.mc_name}\` is already \`${target.status}\` — they don't need sponsoring.`,
    );
    return;
  }

  try {
    await applySponsorship({
      sponsorId: interaction.user.id,
      sponseeId: target.discord_id,
      sponseeMcName: target.mc_name,
      sponseeMcUuid: target.mc_uuid,
      discordClient: interaction.client,
      actor: interaction.user.id,
      source: 'panel',
    });
    const display = String(target.mc_name).replace(/^\./, '');
    await interaction.editReply(`✓ You're now sponsoring \`${display}\`.`);
  } catch (e) {
    log.error('apply-submit failed:', e);
    await interaction.editReply(`✗ ${e.message}`);
  }
});

// ----- My Sponsee -----

buttonHandlers.set('sponsor:my-sponsee', async (interaction) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const user = await getUserByDiscord(interaction.user.id);
  const sponsees = await getActiveSponseesOf(interaction.user.id);

  const strikes = user?.strikes ?? 0;
  const autoPromote = getSetting('auto_promote_days');
  const banThreshold = getSetting('strike_threshold_ban');

  let cooldownLine = '';
  if (user?.next_sponsor_at) {
    const cd = new Date(user.next_sponsor_at);
    if (cd.getTime() > Date.now()) {
      const unix = Math.floor(cd.getTime() / 1000);
      cooldownLine = `\n**Sponsor cooldown:** active until <t:${unix}:R>`;
    }
  }

  if (sponsees.length === 0) {
    await interaction.editReply(
      `**You aren't sponsoring anyone right now.**\n` +
      `**Strikes:** ${strikes}/${banThreshold}${cooldownLine}`,
    );
    return;
  }

  const lines = sponsees.map((s) => {
    const display = String(s.mc_name ?? '').replace(/^\./, '') || s.discord_id;
    if (!s.sponsored_at) return `• \`${display}\` — sponsored_at unknown`;
    const days = (Date.now() - new Date(s.sponsored_at).getTime()) / (24 * 60 * 60 * 1000);
    const remaining = Math.max(0, autoPromote - days);
    return `• \`${display}\` — ${remaining.toFixed(1)} days to auto-promote (sponsored ${days.toFixed(1)} days ago)`;
  });

  await interaction.editReply(
    `**Your sponsees (${sponsees.length}):**\n${lines.join('\n')}\n\n` +
    `**Strikes:** ${strikes}/${banThreshold}${cooldownLine}`,
  );
});

// ----- My Strikes -----

buttonHandlers.set('sponsor:my-strikes', async (interaction) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const user = await getUserByDiscord(interaction.user.id);
  const strikes = user?.strikes ?? 0;
  const banThreshold = getSetting('strike_threshold_ban');
  const suspendThreshold = getSetting('strike_threshold_suspend');

  const logs = await getSponsorLogs({ userId: interaction.user.id, limit: 20 });
  const punishments = logs.filter((l) =>
    l.sponsor_discord_id === interaction.user.id &&
    (l.action === 'punish' || l.action === 'punish_sponsor_banned' || l.action === 'punish_sponsor_suspended'),
  );

  const history = punishments.length > 0
    ? punishments.slice(0, 10).map((p) => {
        const t = `<t:${Math.floor(new Date(p.timestamp).getTime() / 1000)}:R>`;
        return `${t} ${p.severity ?? '?'} (+${p.strike_delta ?? 0})`;
      }).join('\n')
    : '_No punishments yet._';

  const embed = new EmbedBuilder()
    .setColor(strikes >= suspendThreshold ? 0xED4245 : strikes > 0 ? 0xFEE75C : 0x57F287)
    .setTitle('⚠️ Your Strikes')
    .setDescription(
      `**Current:** ${strikes}\n` +
      `**Suspend at:** ${suspendThreshold}\n` +
      `**Ban at:** ${banThreshold}\n\n` +
      `**Recent punishments:**\n${history}`,
    );

  await interaction.editReply({ embeds: [embed] });
});

// ----- Remove Sponsorship -----

function buildConfirmation(sponsee) {
  const display = String(sponsee.mc_name ?? '').replace(/^\./, '') || sponsee.discord_id;
  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('Remove sponsorship?')
    .setDescription(
      `This will:\n` +
      `• Remove \`${display}\` from the main server whitelist\n` +
      `• Set their status back to 'linked'\n` +
      `• Apply a ${getSetting('sponsor_remove_cooldown_hours')}h cooldown before you can sponsor again\n\n` +
      `Proceed?`,
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sponsor:remove-confirm:${sponsee.discord_id}`).setLabel('Yes, remove').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('sponsor:remove-cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  return { content: '', embeds: [embed], components: [row] };
}

buttonHandlers.set('sponsor:remove', async (interaction) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sponsees = await getActiveSponseesOf(interaction.user.id);
  if (sponsees.length === 0) {
    await interaction.editReply(`You're not currently sponsoring anyone.`);
    return;
  }
  if (sponsees.length === 1) {
    await interaction.editReply(buildConfirmation(sponsees[0]));
    return;
  }
  // Multiple: select picker.
  const options = sponsees.map((s) => ({
    label: String(s.mc_name ?? '').replace(/^\./, '') || s.discord_id,
    value: s.discord_id,
  }));
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('sponsor:remove-pick')
      .setPlaceholder('Pick a sponsee')
      .addOptions(options),
  );
  await interaction.editReply({ content: 'Which sponsorship to remove?', components: [row] });
});

selectMenuHandlers.set('sponsor:remove-pick', async (interaction) => {
  const sponseeId = interaction.values[0];
  const sponsee = await getUserByDiscord(sponseeId);
  if (!sponsee || sponsee.sponsor_discord_id !== interaction.user.id || sponsee.status !== 'sponsee') {
    await interaction.update({ content: 'That sponsorship no longer exists.', embeds: [], components: [] });
    return;
  }
  await interaction.update(buildConfirmation(sponsee));
});

buttonHandlers.set('sponsor:remove-cancel', async (interaction) => {
  await interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
});

buttonHandlers.set('sponsor:remove-confirm', async (interaction, sponseeId) => {
  await interaction.update({ content: 'Removing...', embeds: [], components: [] });

  const sponsee = await getUserByDiscord(sponseeId);
  if (!sponsee || sponsee.sponsor_discord_id !== interaction.user.id || sponsee.status !== 'sponsee') {
    await interaction.editReply('That sponsorship no longer exists.');
    return;
  }

  try {
    await removeSponsorship({
      sponseeUser: sponsee,
      discordClient: interaction.client,
      actor: interaction.user.id,
      applySponsorCooldown: true,
      source: 'panel',
    });
    const display = String(sponsee.mc_name ?? '').replace(/^\./, '') || sponsee.discord_id;
    await interaction.editReply(`✓ Removed sponsorship of \`${display}\`.`);
  } catch (e) {
    log.error('remove-confirm failed:', e);
    await interaction.editReply(`✗ ${e.message}`);
  }
});
