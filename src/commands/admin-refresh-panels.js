import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { refreshPanels } from '../panels/refresh.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-refresh-panels')
  .setDescription('Admin: re-post all persistent panels in their configured channels.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const results = await refreshPanels(interaction.client);
  const lines = results.map((r) => `${r.ok ? '✓' : '✗'} ${r.name}${r.reason ? ` — ${r.reason}` : ''}`);
  await interaction.editReply(lines.join('\n'));
}
