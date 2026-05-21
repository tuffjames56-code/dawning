import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { requireAdmin } from '../utils/admin-gate.js';
import { blockUser } from '../utils/blocklist.js';

export const data = new SlashCommandBuilder()
  .setName('block')
  .setDescription('Admin: block a user from interacting with this bot.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('User to block').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Optional reason').setRequired(false));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') ?? null;

  if (target.id === interaction.user.id) {
    await interaction.reply({ content: 'Can\'t block yourself.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (target.bot) {
    await interaction.reply({ content: 'Bots can\'t be blocked.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    await blockUser({ discordId: target.id, blockedBy: interaction.user.id, reason });
    await interaction.reply({
      content: `✓ <@${target.id}> blocked from the bot${reason ? ` — ${reason}` : ''}.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (e) {
    await interaction.reply({ content: `✗ ${e.message}`, flags: MessageFlags.Ephemeral });
  }
}
