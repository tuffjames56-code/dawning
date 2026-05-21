import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { clearCooldowns } from '../systems/users/admin-actions.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-user-clear-cooldowns')
  .setDescription('Admin: clear next_link_at and next_sponsor_at for a user.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const user = interaction.options.getUser('user');
  await clearCooldowns(user.id, interaction.user.id);
  await interaction.reply({ content: `✓ Cleared cooldowns for <@${user.id}>.`, flags: MessageFlags.Ephemeral });
}
