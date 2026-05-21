import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { requireAdmin } from '../utils/admin-gate.js';
import { getLinkedUsersWithMcName } from '../db/queries.js';
import { setNicknameToMc } from '../utils/discord-nickname.js';

export const data = new SlashCommandBuilder()
  .setName('admin-sync-nicknames')
  .setDescription('Admin: set every linked user\'s Discord nickname to their MC username.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rows = await getLinkedUsersWithMcName();
  if (rows.length === 0) {
    await interaction.editReply('No linked users with an MC name found.');
    return;
  }

  let updated = 0, unchanged = 0, failed = 0;
  const failures = [];
  for (const r of rows) {
    const result = await setNicknameToMc(interaction.client, r.discord_id, r.mc_name);
    if (result.ok && result.unchanged) unchanged++;
    else if (result.ok)                 updated++;
    else {
      failed++;
      if (failures.length < 5) failures.push(`<@${r.discord_id}>: ${result.reason}`);
    }
  }

  const tail = failures.length > 0
    ? `\n\nFirst ${failures.length} failure(s):\n${failures.join('\n')}`
    : '';
  await interaction.editReply(
    `Scanned ${rows.length} linked users — updated: ${updated}, unchanged: ${unchanged}, failed: ${failed}.${tail}`,
  );
}
