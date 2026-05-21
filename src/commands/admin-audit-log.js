import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getSponsorLogs } from '../db/queries.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-audit-log')
  .setDescription('Admin: recent sponsor_logs entries (optionally filtered by user).')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('Filter to entries involving this user').setRequired(false));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const user = interaction.options.getUser('user');
  const logs = await getSponsorLogs({ userId: user?.id ?? null, limit: 20 });
  if (logs.length === 0) {
    await interaction.editReply(user ? `No entries for <@${user.id}>.` : 'No entries.');
    return;
  }
  const lines = logs.map((l) => {
    const t = `<t:${Math.floor(new Date(l.timestamp).getTime() / 1000)}:R>`;
    const sp = l.sponsor_discord_id ? `<@${l.sponsor_discord_id}>` : '_';
    const se = l.sponsee_discord_id ? `<@${l.sponsee_discord_id}>` : '_';
    return `${t} \`${l.action}\` ${sp} → ${se}${l.notes ? ` — ${l.notes}` : ''}`;
  });
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(user ? `Audit log for ${user.username}` : 'Recent audit log')
    .setDescription(lines.join('\n').slice(0, 4000));
  await interaction.editReply({ embeds: [embed] });
}
