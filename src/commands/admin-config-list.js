import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { listSettings } from '../systems/settings/index.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-config-list')
  .setDescription('Admin: list all settings grouped by category.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const all = listSettings();
  const byCategory = new Map();
  for (const s of all) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category).push(s);
  }

  const fields = [];
  for (const [cat, items] of Array.from(byCategory).sort()) {
    const lines = items
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((s) => {
        const v = typeof s.value === 'string' ? `"${s.value}"` : JSON.stringify(s.value);
        return `\`${s.key}\` = \`${v}\`${s.overridden ? ' *(set)*' : ''}`;
      })
      .join('\n');
    fields.push({ name: cat, value: lines.slice(0, 1024) });
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`Settings (${all.length} registered, ${all.filter((s) => s.overridden).length} overridden)`)
    .addFields(fields.slice(0, 25));

  await interaction.editReply({ embeds: [embed] });
}
