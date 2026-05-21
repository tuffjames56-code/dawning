// Formats a GitHub push event into a clean Discord embed and posts it to
// the configured changelog channel. Called from src/api/server.js when a
// `POST /github` arrives.
//
// Format:
//
//   📦 2 commits to main
//   by Vikas
//
//   `a1b2c3` make hooks more undetected & fix auto pearl catch
//      [+] 14   [~] 11   [-] 0
//
//   `d4e5f6` add new pearl detection
//      [+] 3   [~] 2   [-] 0
//
//   ─────────────────────
//   Dawning · today at 6:57
//
// Customise the look in formatPushEmbed below.

import { EmbedBuilder } from 'discord.js';
import { getSetting } from '../systems/settings/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('changelog');

const MAX_COMMITS_SHOWN = 8;
const MAX_MESSAGE_CHARS = 80;
const COLOR_PUSH = 0x2B2D31; // muted near-black, matches Discord dark mode

function shouldPost(branch) {
  if (!getSetting('changelog_enabled')) return false;
  if (!getSetting('changelog_channel_id')) return false;
  const allowed = (getSetting('changelog_branches') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(branch);
}

function firstLine(message) {
  const line = String(message ?? '').split('\n')[0];
  return line.length > MAX_MESSAGE_CHARS ? line.slice(0, MAX_MESSAGE_CHARS - 1) + '…' : line;
}

function formatPushEmbed(payload) {
  const branch     = String(payload.ref ?? '').replace('refs/heads/', '');
  const commits    = Array.isArray(payload.commits) ? payload.commits : [];
  const total      = commits.length;
  const pusher     = payload.pusher?.name ?? payload.sender?.login ?? 'someone';
  const senderUrl  = payload.sender?.html_url;
  const avatarUrl  = payload.sender?.avatar_url ?? null;
  const compareUrl = payload.compare ?? payload.repository?.html_url ?? null;

  // Build the commit block.
  const shown = commits.slice(-MAX_COMMITS_SHOWN); // most recent N
  const lines = shown.map((c) => {
    const sha     = String(c.id ?? '').slice(0, 7);
    const subject = firstLine(c.message);
    const adds = (c.added    ?? []).length;
    const mods = (c.modified ?? []).length;
    const rems = (c.removed  ?? []).length;
    const link = c.url ? `[\`${sha}\`](${c.url})` : `\`${sha}\``;
    return `${link} ${subject}\n  \`[+] ${adds}   [~] ${mods}   [-] ${rems}\``;
  });

  const overflow = total > shown.length ? `\n_…and ${total - shown.length} more_` : '';
  const headerLink = compareUrl ? `[**${total} commit${total === 1 ? '' : 's'} to \`${branch}\`**](${compareUrl})` : `**${total} commit${total === 1 ? '' : 's'} to \`${branch}\`**`;
  const pusherLine = senderUrl ? `by [${pusher}](${senderUrl})` : `by ${pusher}`;

  const desc = `${headerLink}\n${pusherLine}\n\n${lines.join('\n\n')}${overflow}`;

  return new EmbedBuilder()
    .setColor(COLOR_PUSH)
    .setDescription(desc.slice(0, 4000))
    .setFooter({ text: 'Dawning', iconURL: avatarUrl ?? undefined })
    .setTimestamp(new Date());
}

export async function postPushEvent(discordClient, payload) {
  try {
    const branch = String(payload.ref ?? '').replace('refs/heads/', '');
    if (!shouldPost(branch)) return { skipped: true, reason: 'disabled or branch filtered' };

    const commits = Array.isArray(payload.commits) ? payload.commits : [];
    if (commits.length === 0) return { skipped: true, reason: 'empty push (probably a force-push or branch create)' };

    const channelId = getSetting('changelog_channel_id');
    const channel = await discordClient.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      log.warn(`changelog channel ${channelId} not reachable`);
      return { skipped: true, reason: 'channel not reachable' };
    }

    await channel.send({
      embeds: [formatPushEmbed(payload)],
      allowedMentions: { parse: [] },
    });
    log.info(`posted ${commits.length} commit(s) to changelog (branch=${branch})`);
    return { ok: true };
  } catch (e) {
    log.error('postPushEvent failed:', e);
    return { ok: false, reason: e.message };
  }
}
