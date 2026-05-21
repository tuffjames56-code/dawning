import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { setUserStatus } from '../systems/users/admin-actions.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-user-status')
  .setDescription('Admin: force a user\'s status.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
  .addStringOption((o) => o.setName('status').setDescription('New status').setRequired(true)
    .addChoices(
      { name: 'none', value: 'none' },
      { name: 'linked', value: 'linked' },
      { name: 'sponsee', value: 'sponsee' },
      { name: 'trusted', value: 'trusted' },
      { name: 'banned', value: 'banned' },
    ));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const user = interaction.options.getUser('user');
  const status = interaction.options.getString('status');
  try {
    const r = await setUserStatus(user.id, status, interaction.user.id);
    await interaction.reply({ content: `✓ <@${user.id}> status: ${r.before} → ${r.after}`, flags: MessageFlags.Ephemeral });
  } catch (e) {
    await interaction.reply({ content: `✗ ${e.message}`, flags: MessageFlags.Ephemeral });
  }
}
