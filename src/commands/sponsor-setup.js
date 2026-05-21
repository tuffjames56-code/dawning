import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { buildSponsorPanel } from '../panels/sponsor.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('sponsor-setup')
  .setDescription('Admin: post the persistent sponsor panel in this channel.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.channel.send(buildSponsorPanel());
  await interaction.reply({ content: '✓ Sponsor panel posted.', flags: MessageFlags.Ephemeral });
}
