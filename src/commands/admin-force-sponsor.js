import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getUserByDiscord } from '../db/queries.js';
import { applySponsorship } from '../systems/sponsor/actions.js';
import { requireAdmin } from '../utils/admin-gate.js';

// Sponsorship-namespace variant of /admin-user-force-sponsor with arg order
// (sponsor, sponsee) instead of (sponsee, sponsor). Same underlying action.
export const data = new SlashCommandBuilder()
  .setName('admin-force-sponsor')
  .setDescription('Admin: create a sponsorship. Bypasses canSponsor.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('sponsor').setDescription('Sponsor').setRequired(true))
  .addUserOption((o) => o.setName('sponsee').setDescription('Sponsee (must be linked)').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sponsor = interaction.options.getUser('sponsor');
  const sponsee = interaction.options.getUser('sponsee');
  const sponseeRow = await getUserByDiscord(sponsee.id);
  if (!sponseeRow?.mc_name) {
    await interaction.editReply(`<@${sponsee.id}> isn't linked.`);
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
    await interaction.editReply(`✓ <@${sponsor.id}> is sponsoring <@${sponsee.id}>.`);
  } catch (e) {
    await interaction.editReply(`✗ ${e.message}`);
  }
}
