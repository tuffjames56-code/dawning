import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { resetSetting } from '../systems/settings/index.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-config-reset')
  .setDescription('Admin: restore a setting to its default.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) => o.setName('key').setDescription('Setting key').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const key = interaction.options.getString('key');
  try {
    const r = await resetSetting(key, interaction.user.id);
    await interaction.reply({
      content: r.wasOverridden
        ? `✓ Reset \`${key}\` to default: \`${JSON.stringify(r.newValue)}\``
        : `\`${key}\` was already at default.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (e) {
    await interaction.reply({ content: `✗ ${e.message}`, flags: MessageFlags.Ephemeral });
  }
}
