import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { requireAdmin } from '../utils/admin-gate.js';
import { unblockUser } from '../utils/blocklist.js';

export const data = new SlashCommandBuilder()
  .setName('unblock')
  .setDescription('Admin: unblock a user previously blocked from the bot.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('User to unblock').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const target = interaction.options.getUser('user');
  try {
    const existed = await unblockUser(target.id);
    await interaction.reply({
      content: existed ? `✓ <@${target.id}> unblocked.` : `<@${target.id}> wasn't blocked.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (e) {
    await interaction.reply({ content: `✗ ${e.message}`, flags: MessageFlags.Ephemeral });
  }
}
