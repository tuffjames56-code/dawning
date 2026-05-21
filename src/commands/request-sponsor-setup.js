import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { buildRequestSponsorPanel } from '../panels/request-sponsor.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('request-sponsor-setup')
  .setDescription('Admin: post the persistent Request-a-Sponsor panel in this channel.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.channel.send(buildRequestSponsorPanel());
  await interaction.reply({ content: '✓ Request-a-Sponsor panel posted.', flags: MessageFlags.Ephemeral });
}
