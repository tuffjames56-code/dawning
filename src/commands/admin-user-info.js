import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getUserByDiscord } from '../db/queries.js';
import { renderUserEmbed } from '../systems/users/admin-actions.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-user-info')
  .setDescription('Admin: show full record for a user.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const user = await getUserByDiscord(interaction.options.getUser('user').id);
  await interaction.editReply({ embeds: [renderUserEmbed(user)] });
}
