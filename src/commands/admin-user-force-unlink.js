import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { forceUnlinkRaw } from '../systems/users/admin-actions.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-user-force-unlink')
  .setDescription('Admin: raw-nuke user row (no RCON/role cleanup). Use when the cascade is impossible.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const user = interaction.options.getUser('user');
  await forceUnlinkRaw(user.id, interaction.user.id);
  await interaction.reply({ content: `✓ Force-unlinked <@${user.id}> (raw — no cascade).`, flags: MessageFlags.Ephemeral });
}
