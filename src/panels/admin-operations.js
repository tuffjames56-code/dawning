// Operations subpanel.
//   admin:open:operations              -> menu
//   admin:ops:refresh-panels           -> re-post all persistent panels
//   admin:ops:reload-settings          -> reloadSettings()
//   admin:ops:trigger:expiry           -> stub (chunk 5)
//   admin:ops:trigger:decay            -> stub (chunk 5)
//   admin:ops:trigger:promotion        -> stub (chunk 5)
//   admin:ops:maintenance              -> toggle maintenance_mode

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { buttonHandlers } from './registry.js';
import { requireAdmin } from '../utils/admin-gate.js';
import { reloadSettings, getSetting, setSetting } from '../systems/settings/index.js';
import { refreshPanels } from './refresh.js';
import { runTask } from '../systems/tasks/index.js';

export async function renderOperationsHome(interaction) {
  const maintenance = getSetting('maintenance_mode');
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🤖 Operations')
    .setDescription(
      `Maintenance mode is currently **${maintenance ? 'ON' : 'OFF'}**.\n\n` +
      `Background tasks run automatically — click a Trigger button to force a sweep now.`,
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:ops:refresh-panels').setLabel('Refresh Panels').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin:ops:reload-settings').setLabel('Reload Settings').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:ops:maintenance').setLabel(maintenance ? 'Disable Maintenance' : 'Enable Maintenance').setStyle(maintenance ? ButtonStyle.Success : ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:ops:trigger:expiry').setLabel('Force Expire Requests').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:ops:trigger:decay').setLabel('Force Strike Decay').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:ops:trigger:promotion').setLabel('Force Auto-Promote').setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [row1, row2], flags: MessageFlags.Ephemeral });
}

buttonHandlers.set('admin:ops:refresh-panels', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const results = await refreshPanels(interaction.client);
  const lines = results.map((r) => `${r.ok ? '✓' : '✗'} ${r.name}${r.reason ? ` — ${r.reason}` : ''}`);
  await interaction.editReply(lines.join('\n'));
});

buttonHandlers.set('admin:ops:reload-settings', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await reloadSettings();
  await interaction.editReply('✓ Settings re-loaded from DB.');
});

buttonHandlers.set('admin:ops:maintenance', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  const current = getSetting('maintenance_mode');
  await setSetting('maintenance_mode', !current, interaction.user.id);
  await interaction.reply({ content: `✓ maintenance_mode is now **${!current ? 'ON' : 'OFF'}**.`, flags: MessageFlags.Ephemeral });
});

buttonHandlers.set('admin:ops:trigger', async (interaction, task) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const out = await runTask(task, { discordClient: interaction.client });
  if (!out.ok) {
    await interaction.editReply(`✗ \`${task}\` failed: ${out.error}`);
    return;
  }
  const summary = Object.entries(out.result).map(([k, v]) => `${k}: ${v}`).join(', ');
  await interaction.editReply(`✓ \`${task}\` ran — ${summary}`);
});
