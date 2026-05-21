import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { setSetting } from '../systems/settings/index.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-config-set')
  .setDescription('Admin: set a setting value (validated).')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) => o.setName('key').setDescription('Setting key').setRequired(true))
  .addStringOption((o) => o.setName('value').setDescription('New value').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const key = interaction.options.getString('key');
  const value = interaction.options.getString('value');
  try {
    const r = await setSetting(key, value, interaction.user.id);
    await interaction.reply({
      content: `✓ \`${key}\`: \`${JSON.stringify(r.oldValue)}\` → \`${JSON.stringify(r.newValue)}\``,
      flags: MessageFlags.Ephemeral,
    });
  } catch (e) {
    await interaction.reply({ content: `✗ ${e.message}`, flags: MessageFlags.Ephemeral });
  }
}
