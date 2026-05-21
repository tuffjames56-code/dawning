import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { requireAdmin } from '../utils/admin-gate.js';
import { listBlocked } from '../utils/blocklist.js';

export const data = new SlashCommandBuilder()
  .setName('blocklist')
  .setDescription('Admin: show users currently blocked from the bot.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const entries = listBlocked();
  if (entries.length === 0) {
    await interaction.reply({ content: 'Blocklist is empty.', flags: MessageFlags.Ephemeral });
    return;
  }
  const lines = entries.slice(0, 25).map((e) => {
    const at  = e.blocked_at ? `<t:${Math.floor(new Date(e.blocked_at).getTime() / 1000)}:R>` : '?';
    const who = e.blocked_by ? `by <@${e.blocked_by}>` : 'by ?';
    const why = e.reason ? ` — ${e.reason}` : '';
    return `• <@${e.discord_id}> ${who} ${at}${why}`;
  });
  await interaction.reply({
    content: `**Blocked (${entries.length}):**\n${lines.join('\n')}`,
    flags: MessageFlags.Ephemeral,
  });
}
