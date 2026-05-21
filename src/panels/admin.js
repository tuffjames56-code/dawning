// Main admin panel - five subpanel entry buttons. Each subpanel lives in its
// own module (admin-settings.js, admin-users.js, ...) and registers its own
// handlers; this file only dispatches "admin:open:<which>" to the right
// subpanel constructor.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { buttonHandlers } from './registry.js';
import { requireAdmin } from '../utils/admin-gate.js';
import { renderSettingsList } from './admin-settings.js';
import { renderUsersHome }    from './admin-users.js';
import { renderSponsorshipsHome } from './admin-sponsorships.js';
import { renderOperationsHome }   from './admin-operations.js';
import { renderSystemInfo }       from './admin-system-info.js';

export function buildAdminPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x2B2D31)
    .setTitle('🛠️ Admin Panel')
    .setDescription('Server administration. All actions logged.');

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:open:settings').setLabel('Settings').setEmoji('⚙️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin:open:users').setLabel('Users').setEmoji('👥').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin:open:sponsorships').setLabel('Sponsorships').setEmoji('🤝').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:open:operations').setLabel('Operations').setEmoji('🤖').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:open:system-info').setLabel('System Info').setEmoji('📊').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2] };
}

// One handler per subpanel-entry button. Each just verifies admin and hands
// off to the subpanel-rendering function (which sends the ephemeral reply).
const subpanels = {
  'settings':     renderSettingsList,
  'users':        renderUsersHome,
  'sponsorships': renderSponsorshipsHome,
  'operations':   renderOperationsHome,
  'system-info':  renderSystemInfo,
};

buttonHandlers.set('admin:open', async (interaction, which) => {
  if (!(await requireAdmin(interaction))) return;
  const render = subpanels[which];
  if (!render) {
    await interaction.reply({ content: `Unknown subpanel: ${which}`, flags: MessageFlags.Ephemeral });
    return;
  }
  await render(interaction);
});
