import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getUserByDiscord } from '../db/queries.js';
import { promoteToTrusted } from '../systems/sponsor/actions.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-force-promote')
  .setDescription('Admin: promote a user to trusted, skipping the 15-day rule.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const user = interaction.options.getUser('user');
  const row = await getUserByDiscord(user.id);
  if (!row) {
    await interaction.editReply(`No user record for <@${user.id}>.`);
    return;
  }
  try {
    await promoteToTrusted({
      userId: user.id,
      discordClient: interaction.client,
      actor: interaction.user.id,
      source: 'admin',
    });
    await interaction.editReply(`✓ Promoted <@${user.id}> to trusted.`);
  } catch (e) {
    await interaction.editReply(`✗ ${e.message}`);
  }
}
