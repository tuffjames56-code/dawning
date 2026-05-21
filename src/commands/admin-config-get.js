import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getSetting, getSettingMeta } from '../systems/settings/index.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-config-get')
  .setDescription('Admin: show a setting\'s current value + metadata.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) => o.setName('key').setDescription('Setting key').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const key = interaction.options.getString('key');
  const meta = getSettingMeta(key);
  if (!meta) {
    await interaction.reply({ content: `Unknown setting: \`${key}\``, flags: MessageFlags.Ephemeral });
    return;
  }

  const current = getSetting(key);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`⚙️ ${key}`)
    .addFields(
      { name: 'Type', value: meta.type, inline: true },
      { name: 'Category', value: meta.category, inline: true },
      { name: 'Current', value: `\`${JSON.stringify(current)}\``, inline: true },
      { name: 'Default', value: `\`${JSON.stringify(meta.defaultValue)}\``, inline: true },
      ...(meta.min !== undefined ? [{ name: 'Min', value: String(meta.min), inline: true }] : []),
      ...(meta.max !== undefined ? [{ name: 'Max', value: String(meta.max), inline: true }] : []),
      { name: 'Description', value: meta.description || '_no description_' },
    );

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
