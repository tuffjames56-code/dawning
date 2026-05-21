import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { buildSystemInfoEmbed } from '../panels/admin-system-info.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-system-info')
  .setDescription('Admin: snapshot of bot/mineflayer/RCON/DB stats.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply({ embeds: [await buildSystemInfoEmbed()] });
}
