// Users subpanel: modal-driven user lookup, then per-user action buttons.
//
// customId map:
//   admin:open:users                     -> entry
//   admin:users:lookup-submit            -> modal -> render record
//   admin:users:set-status:<discordId>   -> select menu for new status
//   admin:users:status-pick:<discordId>  -> select submit
//   admin:users:set-sponsor:<discordId>  -> modal asking for sponsor discord_id
//   admin:users:sponsor-submit:<discordId>
//   admin:users:clear-cooldowns:<discordId>
//   admin:users:reset-strikes:<discordId>
//   admin:users:force-unlink:<discordId>
//   admin:users:dm:<discordId>           -> modal
//   admin:users:dm-submit:<discordId>
//   admin:users:audit:<discordId>        -> show sponsor_logs

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
import { requireAdmin } from '../utils/admin-gate.js';
import { getUserByDiscord, getUserByMcName, getSponsorLogs, updateUserFields } from '../db/queries.js';
import {
  renderUserEmbed,
  setUserStatus,
  clearCooldowns,
  resetStrikes,
  forceUnlinkRaw,
  adminDM,
} from '../systems/users/admin-actions.js';

// ----- lookup -----

export async function renderUsersHome(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('admin:users:lookup-submit')
    .setTitle('Lookup user')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('q')
          .setLabel('Discord ID, @mention, or MC name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
}

// Resolve a query string to a users row. Accepts Discord IDs (raw 17-19 digit
// snowflakes), mentions <@id>, or MC names.
async function resolveUser(q) {
  const trimmed = q.trim();
  const mentionMatch = trimmed.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return await getUserByDiscord(mentionMatch[1]);
  if (/^\d{15,21}$/.test(trimmed)) {
    return (await getUserByDiscord(trimmed)) ?? null;
  }
  return await getUserByMcName(trimmed);
}

function actionRows(discordId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`admin:users:set-status:${discordId}`).setLabel('Force Status').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`admin:users:set-sponsor:${discordId}`).setLabel('Set Sponsor').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`admin:users:clear-cooldowns:${discordId}`).setLabel('Clear Cooldowns').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`admin:users:reset-strikes:${discordId}`).setLabel('Reset Strikes').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`admin:users:force-unlink:${discordId}`).setLabel('Force Unlink (raw)').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`admin:users:dm:${discordId}`).setLabel('Send DM').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`admin:users:audit:${discordId}`).setLabel('View Audit').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

modalHandlers.set('admin:users:lookup-submit', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const q = interaction.fields.getTextInputValue('q');
  const user = await resolveUser(q);
  if (!user) {
    await interaction.editReply(`No user found for \`${q}\`.`);
    return;
  }
  await interaction.editReply({ embeds: [renderUserEmbed(user)], components: actionRows(user.discord_id) });
});

// ----- status -----

buttonHandlers.set('admin:users:set-status', async (interaction, discordId) => {
  if (!(await requireAdmin(interaction))) return;
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`admin:users:status-pick:${discordId}`)
      .setPlaceholder('Pick new status')
      .addOptions(
        ['none', 'linked', 'sponsee', 'trusted', 'banned'].map((s) => ({ label: s, value: s })),
      ),
  );
  await interaction.reply({ content: `Set status for <@${discordId}>:`, components: [row], flags: MessageFlags.Ephemeral });
});

selectMenuHandlers.set('admin:users:status-pick', async (interaction, discordId) => {
  if (!(await requireAdmin(interaction))) return;
  const status = interaction.values[0];
  try {
    const r = await setUserStatus(discordId, status, interaction.user.id);
    await interaction.update({ content: `✓ <@${discordId}> status: ${r.before} → ${r.after}`, components: [] });
  } catch (e) {
    await interaction.update({ content: `✗ ${e.message}`, components: [] });
  }
});

// ----- sponsor -----

buttonHandlers.set('admin:users:set-sponsor', async (interaction, discordId) => {
  if (!(await requireAdmin(interaction))) return;
  const modal = new ModalBuilder()
    .setCustomId(`admin:users:sponsor-submit:${discordId}`)
    .setTitle('Set sponsor')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sponsor')
          .setLabel('Sponsor Discord ID (or empty to clear)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ),
    );
  await interaction.showModal(modal);
});

modalHandlers.set('admin:users:sponsor-submit', async (interaction, discordId) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const raw = interaction.fields.getTextInputValue('sponsor').trim();
  const sponsorId = raw === '' ? null : raw.replace(/[^0-9]/g, '');
  try {
    await updateUserFields(discordId, {
      sponsor_discord_id: sponsorId,
      sponsored_at: sponsorId ? new Date().toISOString() : null,
    });
    await interaction.editReply(`✓ Sponsor for <@${discordId}>: ${sponsorId ? `<@${sponsorId}>` : '_cleared_'}`);
  } catch (e) {
    await interaction.editReply(`✗ ${e.message}`);
  }
});

// ----- one-shot buttons -----

buttonHandlers.set('admin:users:clear-cooldowns', async (interaction, discordId) => {
  if (!(await requireAdmin(interaction))) return;
  await clearCooldowns(discordId, interaction.user.id);
  await interaction.reply({ content: `✓ Cleared cooldowns for <@${discordId}>.`, flags: MessageFlags.Ephemeral });
});

buttonHandlers.set('admin:users:reset-strikes', async (interaction, discordId) => {
  if (!(await requireAdmin(interaction))) return;
  await resetStrikes(discordId, interaction.user.id);
  await interaction.reply({ content: `✓ Strikes reset for <@${discordId}>.`, flags: MessageFlags.Ephemeral });
});

buttonHandlers.set('admin:users:force-unlink', async (interaction, discordId) => {
  if (!(await requireAdmin(interaction))) return;
  await forceUnlinkRaw(discordId, interaction.user.id);
  await interaction.reply({ content: `✓ Force-unlinked <@${discordId}> (raw row reset, no cascade).`, flags: MessageFlags.Ephemeral });
});

// ----- DM -----

buttonHandlers.set('admin:users:dm', async (interaction, discordId) => {
  if (!(await requireAdmin(interaction))) return;
  const modal = new ModalBuilder()
    .setCustomId(`admin:users:dm-submit:${discordId}`)
    .setTitle('Send DM')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('msg')
          .setLabel('Message body')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1900)
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
});

modalHandlers.set('admin:users:dm-submit', async (interaction, discordId) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const msg = interaction.fields.getTextInputValue('msg');
  try {
    await adminDM(interaction.client, discordId, msg, interaction.user.id);
    await interaction.editReply(`✓ DM sent to <@${discordId}>.`);
  } catch (e) {
    await interaction.editReply(`✗ ${e.message}`);
  }
});

// ----- audit -----

buttonHandlers.set('admin:users:audit', async (interaction, discordId) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const logs = await getSponsorLogs({ userId: discordId, limit: 15 });
  if (logs.length === 0) {
    await interaction.editReply(`No sponsor_logs entries for <@${discordId}>.`);
    return;
  }
  const lines = logs.map((l) => {
    const t = new Date(l.timestamp).toISOString();
    const side = l.sponsor_discord_id === discordId ? 'as sponsor' : 'as sponsee';
    return `\`${t}\` ${l.action} (${side})${l.notes ? ` — ${l.notes}` : ''}`;
  });
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`Audit for ${discordId}`)
    .setDescription(lines.join('\n').slice(0, 4000));
  await interaction.editReply({ embeds: [embed] });
});
