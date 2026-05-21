import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getUserByDiscord } from '../db/queries.js';
import { removeSponsorship } from '../systems/sponsor/actions.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-force-unsponsor')
  .setDescription('Admin: end a sponsorship. Runs the full cascade, admin-initiated.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('sponsee').setDescription('Sponsee').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sponsee = interaction.options.getUser('sponsee');
  const sponseeRow = await getUserByDiscord(sponsee.id);
  if (!sponseeRow) {
    await interaction.editReply(`No user record for <@${sponsee.id}>.`);
    return;
  }
  if (sponseeRow.status !== 'sponsee') {
    await interaction.editReply(`<@${sponsee.id}> isn't a sponsee (status=${sponseeRow.status}).`);
    return;
  }
  try {
    await removeSponsorship({
      sponseeUser: sponseeRow,
      discordClient: interaction.client,
      actor: interaction.user.id,
      applySponsorCooldown: true,
      source: 'admin',
    });
    await interaction.editReply(`✓ Removed sponsorship of <@${sponsee.id}>.`);
  } catch (e) {
    await interaction.editReply(`✗ ${e.message}`);
  }
}
