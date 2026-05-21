import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { resetStrikes } from '../systems/users/admin-actions.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-user-reset-strikes')
  .setDescription('Admin: zero a user\'s strike count.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const user = interaction.options.getUser('user');
  await resetStrikes(user.id, interaction.user.id);
  await interaction.reply({ content: `✓ Strikes reset for <@${user.id}>.`, flags: MessageFlags.Ephemeral });
}
