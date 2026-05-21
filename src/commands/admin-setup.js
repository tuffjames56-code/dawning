import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { buildAdminPanel } from '../panels/admin.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-setup')
  .setDescription('Post the persistent admin panel in this channel.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.channel.send(buildAdminPanel());
  await interaction.reply({ content: '✓ Admin panel posted.', flags: MessageFlags.Ephemeral });
}
