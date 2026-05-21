import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { setSetting } from '../systems/settings/index.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-maintenance')
  .setDescription('Admin: toggle maintenance mode (blocks all new linking).')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) => o.setName('mode').setDescription('on or off').setRequired(true)
    .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const mode = interaction.options.getString('mode');
  const value = mode === 'on';
  await setSetting('maintenance_mode', value, interaction.user.id);
  await interaction.reply({ content: `✓ maintenance_mode = **${value ? 'ON' : 'OFF'}**`, flags: MessageFlags.Ephemeral });
}
