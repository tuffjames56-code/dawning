import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { requireAdmin } from '../utils/admin-gate.js';
import { runTask, TASKS } from '../systems/tasks/index.js';

const TASK_NAMES = Object.keys(TASKS);

export const data = new SlashCommandBuilder()
  .setName('admin-trigger-task')
  .setDescription('Admin: manually trigger a background task.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) => o.setName('task').setDescription('Which task').setRequired(true)
    .addChoices(...TASK_NAMES.map((name) => ({ name, value: name }))));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const task = interaction.options.getString('task');
  const out = await runTask(task, { discordClient: interaction.client });
  if (!out.ok) {
    await interaction.editReply(`✗ \`${task}\` failed: ${out.error}`);
    return;
  }
  const summary = Object.entries(out.result)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  await interaction.editReply(`✓ \`${task}\` ran — ${summary}`);
}
