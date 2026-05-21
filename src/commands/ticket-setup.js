import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { buildTicketsPanel } from '../panels/tickets.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('ticket-setup')
  .setDescription('Admin: post the persistent ticket panel in this channel.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.channel.send(buildTicketsPanel());
  await interaction.reply({ content: '✓ Ticket panel posted. Set `tickets_channel_id` setting to this channel if you haven\'t already.', flags: MessageFlags.Ephemeral });
}
