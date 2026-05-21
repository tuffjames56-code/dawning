// Tickets panel. Side-effect registers the button handlers.
//
// Flow:
//   1. /ticket-setup posts an embed with a "Create Ticket" button in the
//      configured tickets channel.
//   2. User clicks Create Ticket → bot opens a private thread under that
//      channel, adds the user + ADMIN_ROLE_ID, posts a welcome.
//   3. Admin (or the user themselves) clicks "Close" → thread is locked +
//      archived.
//
// State lives in the thread itself (name + parent channel). No DB.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { buttonHandlers } from './registry.js';
import { env } from '../utils/config.js';
import { getSetting } from '../systems/settings/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('tickets');

const THREAD_USER_ID_RE = /\((\d{15,22})\)\s*$/;

export function buildTicketsPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎫 Tickets')
    .setDescription(
      'Need help or want to report something? Click below to open a private ticket. ' +
      'Only you and the staff will see it.',
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:create').setLabel('Create Ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

// ----- Create Ticket -----

buttonHandlers.set('ticket:create', async (interaction) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channelId = getSetting('tickets_channel_id');
  if (!channelId) {
    await interaction.editReply('Tickets aren\'t configured yet (tickets_channel_id is empty).');
    return;
  }

  let channel;
  try { channel = await interaction.client.channels.fetch(channelId); }
  catch (e) { await interaction.editReply(`Can't reach the tickets channel: ${e.message}`); return; }

  // One open ticket per user. Look for an existing thread by id-suffix.
  try {
    const active = await channel.threads.fetchActive();
    for (const [, t] of active.threads) {
      const m = THREAD_USER_ID_RE.exec(t.name ?? '');
      if (m && m[1] === interaction.user.id) {
        await interaction.editReply(`You already have an open ticket: <#${t.id}>.`);
        return;
      }
    }
  } catch (e) { log.warn(`active-threads scan: ${e.message}`); }

  // Create a private thread for the user.
  let thread;
  try {
    thread = await channel.threads.create({
      name: `🎫 ${interaction.user.username} (${interaction.user.id})`.slice(0, 100),
      type: ChannelType.PrivateThread,
      autoArchiveDuration: 1440,
      invitable: false,
      reason: `ticket opened by ${interaction.user.tag}`,
    });
  } catch (e) {
    // Some servers can't host private threads (server boost tier). Fall back
    // to public thread inside the (admin-only) tickets channel.
    log.warn(`private thread failed, falling back to public: ${e.message}`);
    try {
      thread = await channel.threads.create({
        name: `🎫 ${interaction.user.username} (${interaction.user.id})`.slice(0, 100),
        type: ChannelType.PublicThread,
        autoArchiveDuration: 1440,
        reason: `ticket opened by ${interaction.user.tag}`,
      });
    } catch (e2) {
      await interaction.editReply(`Couldn't open a ticket: ${e2.message}`);
      return;
    }
  }

  // Add the user + admin pingable role.
  try { await thread.members.add(interaction.user.id); } catch { /* noop */ }
  const greeting = env.discord.adminRoleId
    ? `<@${interaction.user.id}> opened a ticket. <@&${env.discord.adminRoleId}> someone will be with you soon.`
    : `<@${interaction.user.id}> opened a ticket. A staff member will be with you soon.`;

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
  );
  await thread.send({ content: greeting, components: [closeRow], allowedMentions: { users: [interaction.user.id], roles: env.discord.adminRoleId ? [env.discord.adminRoleId] : [] } });

  await interaction.editReply(`✓ Opened: <#${thread.id}>`);
  log.info(`ticket opened by ${interaction.user.tag} in thread ${thread.id}`);
});

// ----- Close Ticket -----

buttonHandlers.set('ticket:close', async (interaction) => {
  const thread = interaction.channel;
  if (!thread?.isThread?.()) {
    await interaction.reply({ content: 'Use this inside a ticket thread.', flags: MessageFlags.Ephemeral });
    return;
  }
  const tixChannelId = getSetting('tickets_channel_id');
  if (tixChannelId && thread.parentId !== tixChannelId) {
    await interaction.reply({ content: 'This isn\'t a ticket thread.', flags: MessageFlags.Ephemeral });
    return;
  }
  // Owner of the ticket OR an admin can close it.
  const m = THREAD_USER_ID_RE.exec(thread.name ?? '');
  const ownerId = m?.[1];
  const isOwner = ownerId === interaction.user.id;
  const isAdmin = env.discord.adminRoleId && interaction.member?.roles?.cache?.has(env.discord.adminRoleId);
  if (!isOwner && !isAdmin) {
    await interaction.reply({ content: 'Only the ticket opener or staff can close this.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content: `🎫 Closed by <@${interaction.user.id}>.`, flags: 0 });
  try { await thread.setLocked(true,   'ticket closed'); } catch (e) { log.warn(`setLocked: ${e.message}`); }
  try { await thread.setArchived(true, 'ticket closed'); } catch (e) { log.warn(`setArchived: ${e.message}`); }
});

// Slash command setup is in commands/ticket-setup.js but it's allowed to also
// live here as an export consumed by /admin-refresh-panels later if desired.
