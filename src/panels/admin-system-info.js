// System Info subpanel: read-only embed assembled from in-memory + DB stats.

import { EmbedBuilder, MessageFlags } from 'discord.js';
import { requireAdmin } from '../utils/admin-gate.js';
import { mc } from '../mineflayer/bot.js';
import { getRconLastSuccess } from '../rcon/client.js';
import { apiStats, recentApiRequestCount } from '../api/server.js';
import { countUsersByStatus, getActiveSponsorships, getPendingSponsorRequests } from '../db/queries.js';
import { listSettings } from '../systems/settings/index.js';

const startedAt = Date.now();

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return d > 0 ? `${d}d ${h}h ${m}m`
       : h > 0 ? `${h}h ${m}m`
       : m > 0 ? `${m}m ${sec}s`
       : `${sec}s`;
}

function fmtTs(ts) {
  return ts ? `<t:${Math.floor(ts / 1000)}:R>` : 'never';
}

export async function buildSystemInfoEmbed() {
  const statuses = await countUsersByStatus();
  const sponsorships = await getActiveSponsorships();
  const pendingRequests = await getPendingSponsorRequests();
  const settings = listSettings();

  const mineflayerOk = !!mc.bot;
  const mineflayerInfo = mineflayerOk
    ? `connected as \`${mc.bot.username}\` (uuid \`${mc.bot.player?.uuid ?? '?'}\`)`
    : `disconnected`;

  const rconLast = getRconLastSuccess();

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📊 System Info')
    .addFields(
      { name: 'Uptime',     value: fmtDuration(Date.now() - startedAt), inline: true },
      { name: 'Mineflayer', value: mineflayerInfo, inline: false },
      { name: 'MC commands', value: `last success: ${fmtTs(rconLast)}`, inline: true },
      { name: 'Mod API',    value: `last request: ${fmtTs(apiStats.lastRequestAt)}\nlast hour: ${recentApiRequestCount()}`, inline: true },
      { name: 'Users by status', value:
          `none: ${statuses.none}\n` +
          `linked: ${statuses.linked}\n` +
          `sponsee: ${statuses.sponsee}\n` +
          `trusted: ${statuses.trusted}\n` +
          `banned: ${statuses.banned}`,
        inline: true,
      },
      { name: 'Active sponsorships', value: String(sponsorships.length), inline: true },
      { name: 'Pending requests',    value: String(pendingRequests.length), inline: true },
      { name: 'Settings',
        value: `${settings.length} registered, ${settings.filter((s) => s.overridden).length} overridden`,
        inline: false,
      },
    );
}

export async function renderSystemInfo(interaction) {
  if (!(await requireAdmin(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply({ embeds: [await buildSystemInfoEmbed()] });
}
