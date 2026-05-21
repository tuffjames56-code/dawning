import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { adminDM } from '../systems/users/admin-actions.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-user-dm')
  .setDescription('Admin: send a DM to a user as the bot.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
  .addStringOption((o) => o.setName('message').setDescription('Message body').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const user = interaction.options.getUser('user');
  const msg = interaction.options.getString('message');
  try {
    await adminDM(interaction.client, user.id, msg, interaction.user.id);
    await interaction.editReply(`✓ DM sent to <@${user.id}>.`);
  } catch (e) {
    await interaction.editReply(`✗ ${e.message}`);
  }
}
