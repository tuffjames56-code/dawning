import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getUserByDiscord } from '../db/queries.js';
import { applySponsorship } from '../systems/sponsor/actions.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-user-force-sponsor')
  .setDescription('Admin: assign a sponsor to a user. Bypasses canSponsor checks.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('Sponsee (must be linked)').setRequired(true))
  .addUserOption((o) => o.setName('sponsor').setDescription('Sponsor (any user)').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sponsee = interaction.options.getUser('user');
  const sponsor = interaction.options.getUser('sponsor');

  const sponseeRow = await getUserByDiscord(sponsee.id);
  if (!sponseeRow?.mc_name) {
    await interaction.editReply(`<@${sponsee.id}> isn't linked. They need to /link first.`);
    return;
  }

  try {
    await applySponsorship({
      sponsorId: sponsor.id,
      sponseeId: sponsee.id,
      sponseeMcName: sponseeRow.mc_name,
      sponseeMcUuid: sponseeRow.mc_uuid,
      discordClient: interaction.client,
      actor: interaction.user.id,
      source: 'admin',
    });
    await interaction.editReply(`✓ <@${sponsor.id}> is now sponsoring <@${sponsee.id}> (${sponseeRow.mc_name}).`);
  } catch (e) {
    await interaction.editReply(`✗ ${e.message}`);
  }
}
