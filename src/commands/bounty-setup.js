import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { buildBountyPanel } from '../panels/bounty.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('bounty-setup')
  .setDescription('Admin: post the persistent bounty panel in this channel.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.channel.send(buildBountyPanel());
  await interaction.reply({ content: '✓ Bounty panel posted.', flags: MessageFlags.Ephemeral });
}
