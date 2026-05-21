// Sponsorships subpanel:
//   admin:open:sponsorships               -> menu of action buttons
//   admin:sponsorships:force-sponsor      -> modal: sponsor MC + sponsee MC
//   admin:sponsorships:force-sponsor-submit
//   admin:sponsorships:force-unsponsor    -> modal: sponsee MC
//   admin:sponsorships:force-unsponsor-submit
//   admin:sponsorships:force-promote      -> modal: user discord id
//   admin:sponsorships:force-promote-submit
//   admin:sponsorships:view-active        -> list
//   admin:sponsorships:view-pending       -> list

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { buttonHandlers, modalHandlers } from './registry.js';
import { requireAdmin } from '../utils/admin-gate.js';
import {
  getUserByMcName,
  getUserByDiscord,
  getActiveSponsorships,
  getPendingSponsorRequests,
} from '../db/queries.js';
import { applySponsorship, removeSponsorship, promoteToTrusted } from '../systems/sponsor/actions.js';

export async function renderSponsorshipsHome(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🤝 Sponsorships')
    .setDescription('Admin overrides for sponsor relationships. All bypass canSponsor checks.');

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:sponsorships:force-sponsor').setLabel('Force Sponsor').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin:sponsorships:force-unsponsor').setLabel('Force Un-sponsor').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('admin:sponsorships:force-promote').setLabel('Force Promote').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:sponsorships:view-active').setLabel('View Active').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:sponsorships:view-pending').setLabel('View Pending Requests').setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [row1, row2], flags: MessageFlags.Ephemeral });
}

// ---------- Force Sponsor ----------

buttonHandlers.set('admin:sponsorships:force-sponsor', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  const modal = new ModalBuilder()
    .setCustomId('admin:sponsorships:force-sponsor-submit')
    .setTitle('Force Sponsor')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('sponsor_mc').setLabel('Sponsor MC name').setStyle(TextInputStyle.Short).setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('sponsee_mc').setLabel('Sponsee MC name').setStyle(TextInputStyle.Short).setRequired(true),
      ),
    );
  await interaction.showModal(modal);
});

modalHandlers.set('admin:sponsorships:force-sponsor-submit', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sponsorMc = interaction.fields.getTextInputValue('sponsor_mc');
  const sponseeMc = interaction.fields.getTextInputValue('sponsee_mc');
  const sponsor = await getUserByMcName(sponsorMc);
  const sponsee = await getUserByMcName(sponseeMc);
  if (!sponsor) { await interaction.editReply(`Sponsor not found: \`${sponsorMc}\``); return; }
  if (!sponsee) { await interaction.editReply(`Sponsee not found: \`${sponseeMc}\` (must be linked first)`); return; }
  try {
    await applySponsorship({
      sponsorId: sponsor.discord_id,
      sponseeId: sponsee.discord_id,
      sponseeMcName: sponsee.mc_name,
      sponseeMcUuid: sponsee.mc_uuid,
      discordClient: interaction.client,
      actor: interaction.user.id,
      source: 'admin',
    });
    await interaction.editReply(`✓ \`${sponsor.mc_name}\` is now sponsoring \`${sponsee.mc_name}\`.`);
  } catch (e) { await interaction.editReply(`✗ ${e.message}`); }
});

// ---------- Force Un-sponsor ----------

buttonHandlers.set('admin:sponsorships:force-unsponsor', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  const modal = new ModalBuilder()
    .setCustomId('admin:sponsorships:force-unsponsor-submit')
    .setTitle('Force Un-sponsor')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('sponsee_mc').setLabel('Sponsee MC name').setStyle(TextInputStyle.Short).setRequired(true),
      ),
    );
  await interaction.showModal(modal);
});

modalHandlers.set('admin:sponsorships:force-unsponsor-submit', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sponseeMc = interaction.fields.getTextInputValue('sponsee_mc');
  const sponsee = await getUserByMcName(sponseeMc);
  if (!sponsee) { await interaction.editReply(`Not found: \`${sponseeMc}\``); return; }
  if (sponsee.status !== 'sponsee') {
    await interaction.editReply(`\`${sponseeMc}\` isn't currently a sponsee (status=${sponsee.status}).`);
    return;
  }
  try {
    await removeSponsorship({
      sponseeUser: sponsee,
      discordClient: interaction.client,
      actor: interaction.user.id,
      applySponsorCooldown: true,
      source: 'admin',
    });
    await interaction.editReply(`✓ Removed sponsorship of \`${sponsee.mc_name}\`.`);
  } catch (e) { await interaction.editReply(`✗ ${e.message}`); }
});

// ---------- Force Promote ----------

buttonHandlers.set('admin:sponsorships:force-promote', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  const modal = new ModalBuilder()
    .setCustomId('admin:sponsorships:force-promote-submit')
    .setTitle('Force Promote to Trusted')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('q').setLabel('Discord ID or MC name').setStyle(TextInputStyle.Short).setRequired(true),
      ),
    );
  await interaction.showModal(modal);
});

modalHandlers.set('admin:sponsorships:force-promote-submit', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const q = interaction.fields.getTextInputValue('q').trim();
  const user = /^\d{15,21}$/.test(q) ? await getUserByDiscord(q) : await getUserByMcName(q);
  if (!user) { await interaction.editReply(`Not found: \`${q}\``); return; }
  try {
    await promoteToTrusted({
      userId: user.discord_id,
      discordClient: interaction.client,
      actor: interaction.user.id,
      source: 'admin',
    });
    await interaction.editReply(`✓ Promoted <@${user.discord_id}> (${user.mc_name}) to trusted.`);
  } catch (e) { await interaction.editReply(`✗ ${e.message}`); }
});

// ---------- View Active ----------

buttonHandlers.set('admin:sponsorships:view-active', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rows = await getActiveSponsorships();
  if (rows.length === 0) {
    await interaction.editReply('No active sponsorships.');
    return;
  }
  const lines = rows.map((s) =>
    `<@${s.sponsor_discord_id ?? 'unknown'}> → <@${s.discord_id}> (\`${(s.mc_name ?? '').replace(/^\./, '')}\`) — since ${s.sponsored_at ? new Date(s.sponsored_at).toISOString().slice(0, 10) : '?'}`,
  );
  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle(`Active sponsorships (${rows.length})`)
    .setDescription(lines.join('\n').slice(0, 4000));
  await interaction.editReply({ embeds: [embed] });
});

// ---------- View Pending Requests ----------

buttonHandlers.set('admin:sponsorships:view-pending', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rows = await getPendingSponsorRequests();
  if (rows.length === 0) {
    await interaction.editReply('No pending sponsor requests.');
    return;
  }
  const lines = rows.map((r) => {
    const exp = r.expires_at ? `expires <t:${Math.floor(new Date(r.expires_at).getTime() / 1000)}:R>` : 'no expiry';
    return `#${r.id} <@${r.requester_discord_id}> — ${exp}`;
  });
  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle(`Pending sponsor requests (${rows.length})`)
    .setDescription(lines.join('\n').slice(0, 4000));
  await interaction.editReply({ embeds: [embed] });
});
