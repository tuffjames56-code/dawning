import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getSettingsAudit } from '../db/queries.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-settings-audit')
  .setDescription('Admin: recent settings_audit entries (optionally filtered by key).')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) => o.setName('key').setDescription('Setting key').setRequired(false));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const key = interaction.options.getString('key');
  const rows = await getSettingsAudit({ key, limit: 20 });
  if (rows.length === 0) {
    await interaction.editReply(key ? `No audit entries for \`${key}\`.` : 'No audit entries.');
    return;
  }
  const lines = rows.map((r) => {
    const t = `<t:${Math.floor(new Date(r.changed_at).getTime() / 1000)}:R>`;
    return `${t} \`${r.key}\`: ${r.old_value ?? '_'} → ${r.new_value} (by <@${r.changed_by}>)`;
  });
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(key ? `settings_audit for ${key}` : 'Recent settings audit')
    .setDescription(lines.join('\n').slice(0, 4000));
  await interaction.editReply({ embeds: [embed] });
}
