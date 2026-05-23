// Handles the Allow/Deny buttons on the new-IP DM. customIds:
//   ip:approve:<b64-ip>
//   ip:deny:<b64-ip>

import { MessageFlags } from 'discord.js';
import { buttonHandlers } from './registry.js';
import {
  getUserByDiscord,
  addApprovedIp,
  clearPendingIp,
} from '../db/queries.js';
import { decIp } from '../systems/security/ip-check.js';
import { logger } from '../utils/logger.js';

const log = logger.child('panels/ip-approval');

buttonHandlers.set('ip:approve', async (interaction, b64Ip) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ip = decIp(b64Ip);

  const user = await getUserByDiscord(interaction.user.id);
  if (!user) {
    await interaction.editReply('No linked account found.');
    return;
  }

  try {
    await addApprovedIp(interaction.user.id, ip);
    await clearPendingIp(interaction.user.id);
    log.info(`${interaction.user.id} approved IP ${ip}`);

    // Strip the buttons off the original DM so they can't be re-used.
    try {
      await interaction.message?.edit({ components: [] });
    } catch { /* ignore */ }

    await interaction.editReply(
      `✓ Approved \`${ip}\`. You can now log in from that IP. Rejoin the server.`,
    );
  } catch (e) {
    log.error('approve failed:', e);
    await interaction.editReply(`✗ ${e.message}`);
  }
});

buttonHandlers.set('ip:deny', async (interaction, b64Ip) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ip = decIp(b64Ip);

  await clearPendingIp(interaction.user.id).catch(() => {});
  log.warn(`${interaction.user.id} DENIED IP ${ip} — possible account compromise attempt`);

  try { await interaction.message?.edit({ components: [] }); } catch { /* ignore */ }

  await interaction.editReply(
    '✓ Denied. The IP stays blocked. If this keeps happening, change your Minecraft account password ' +
    'and consider running `/admin-ip clear` (via an admin) to wipe your approved-IP list.',
  );
});
