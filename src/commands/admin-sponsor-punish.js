import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getUserByDiscord } from '../db/queries.js';
import { applyStrikePunishment } from '../systems/sponsor/strikes.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-sponsor-punish')
  .setDescription('Admin: ban a user and apply strikes to their sponsor.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('User to punish').setRequired(true))
  .addStringOption((o) => o.setName('severity').setDescription('Severity').setRequired(true)
    .addChoices(
      { name: 'minor', value: 'minor' },
      { name: 'major', value: 'major' },
    ));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const target = interaction.options.getUser('user');
  const severity = interaction.options.getString('severity');
  const row = await getUserByDiscord(target.id);
  if (!row) {
    await interaction.editReply(`No user record for <@${target.id}>.`);
    return;
  }
  if (row.status === 'banned') {
    await interaction.editReply(`<@${target.id}> is already banned.`);
    return;
  }

  try {
    const result = await applyStrikePunishment({
      sponseeUser: row,
      severity,
      discordClient: interaction.client,
      actor: interaction.user.id,
    });

    const sponsorLine = result.sponsorOutcome === 'no_sponsor'
      ? '_No sponsor — no strikes applied._'
      : result.sponsorOutcome === 'sponsor_missing'
      ? '_Sponsor row missing — no strikes applied._'
      : result.sponsorOutcome === 'sponsor_banned'
      ? `Sponsor banned (${result.sponsorStrikesAfter} strikes).`
      : result.sponsorOutcome === 'sponsor_suspended'
      ? `Sponsor suspended (${result.sponsorStrikesAfter} strikes).`
      : `Sponsor +${result.delta} strikes → ${result.sponsorStrikesAfter} total.`;

    await interaction.editReply(`✓ Banned <@${target.id}> (${severity}).\n${sponsorLine}`);
  } catch (e) {
    await interaction.editReply(`✗ ${e.message}`);
  }
}
