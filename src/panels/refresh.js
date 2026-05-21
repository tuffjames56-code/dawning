// Shared "re-post the persistent panels" logic. Used by both the
// Operations subpanel button and the /admin-refresh-panels slash command.
//
// Each entry posts the panel into the configured channel (if env var is set).
// Chunks 3 + 4 add their own panels here when the sponsor + request panels land.

import { env } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { buildVerifyPanel } from './verify.js';
import { buildAdminPanel } from './admin.js';
import { buildSponsorPanel } from './sponsor.js';
import { buildRequestSponsorPanel } from './request-sponsor.js';
import { buildBountyPanel } from './bounty.js';

const log = logger.child('panels/refresh');

const PANELS = [
  { name: 'verify',          channelEnv: 'verifyChannelId',          build: buildVerifyPanel },
  { name: 'admin',           channelEnv: 'adminPanelChannelId',      build: buildAdminPanel },
  { name: 'sponsor',         channelEnv: 'sponsorChannelId',         build: buildSponsorPanel },
  { name: 'request-sponsor', channelEnv: 'requestSponsorChannelId',  build: buildRequestSponsorPanel },
  { name: 'bounty',          channelEnv: 'bountyChannelId',          build: buildBountyPanel },
];

export async function refreshPanels(discordClient) {
  const results = [];
  for (const p of PANELS) {
    const channelId = env.discord[p.channelEnv];
    if (!channelId) {
      results.push({ name: p.name, ok: false, reason: 'no channel id set' });
      continue;
    }
    try {
      const channel = await discordClient.channels.fetch(channelId);
      await channel.send(p.build());
      results.push({ name: p.name, ok: true });
    } catch (e) {
      log.warn(`refresh ${p.name} panel failed: ${e.message}`);
      results.push({ name: p.name, ok: false, reason: e.message });
    }
  }
  return results;
}
