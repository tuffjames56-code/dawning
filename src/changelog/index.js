// Formats a GitHub push event into a Discord embed and posts it to the
// configured changelog channel. Called from src/api/server.js when a POST
// hits /github.
//
// Layout target:
//
//   [avatar] tuffjames56-code
//
//   ⚡  **2 new commits** on `main`
//
//   > `f033602`  **Test changelog webhook**
//   > 🟢 `0`   🟡 `1`   🔴 `0`
//
//   > `a1b2c3d`  **add new pearl detection**
//   > 🟢 `3`   🟡 `2`   🔴 `0`
//
//   Dawning · today at 12:51 PM

import { EmbedBuilder } from 'discord.js';
import { getSetting } from '../systems/settings/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('changelog');

const MAX_COMMITS_SHOWN = 8;
const MAX_MESSAGE_CHARS = 80;

// Fetches per-commit line stats from the GitHub API. Returns
// { additions, deletions, total } or null on failure. The push webhook only
// includes file counts in `added/modified/removed`, never line counts, so we
// have to call this separately if we want accurate numbers.
async function fetchCommitStats(repoFullName, sha) {
  if (!repoFullName || !sha) return null;
  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'dawning-bot' };
    if (process.env.GITHUB_API_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_API_TOKEN}`;
    }
    const r = await fetch(`https://api.github.com/repos/${repoFullName}/commits/${sha}`, { headers });
    if (!r.ok) {
      log.warn(`commit stats fetch ${sha}: HTTP ${r.status}`);
      return null;
    }
    const json = await r.json();
    return json.stats ?? null;
  } catch (e) {
    log.warn(`commit stats fetch ${sha}: ${e.message}`);
    return null;
  }
}

// Vibrant palette. Each push picks one at random so the channel feels alive
// even when the diff is small.
const VIBRANT_COLORS = [
  0xFF6B6B, 0xF7B731, 0x4ECDC4, 0x5F27CD, 0xEE5A6F,
  0x00D2D3, 0xFEA47F, 0x1DD1A1, 0xFFD93D, 0xF368E0,
  0xFF9FF3, 0x54A0FF, 0xFF4757, 0x2ED573, 0x70A1FF,
  0xFFA502, 0xEB3B5A, 0x26DE81, 0xFC5C65, 0xA55EEA,
];

const HEADER_EMOJI = ['⚡', '🚀', '💥', '🔥', '✨', '🎯', '🌟', '🛠️', '🎉', '🌀', '💫', '⭐'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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

async function formatPushEmbed(payload) {
  const branch     = String(payload.ref ?? '').replace('refs/heads/', '');
  const commits    = Array.isArray(payload.commits) ? payload.commits : [];
  const total      = commits.length;
  const pusher     = payload.pusher?.name ?? payload.sender?.login ?? 'someone';
  const senderUrl  = payload.sender?.html_url ?? null;
  const avatarUrl  = payload.sender?.avatar_url ?? null;
  const compareUrl = payload.compare ?? payload.repository?.html_url ?? null;
  const repoName   = payload.repository?.full_name ?? null;

  // Pull real line stats (additions / deletions) per commit. The push
  // payload only has file lists, so without this we'd show file counts and
  // mislead about diff size.
  const shown = commits.slice(-MAX_COMMITS_SHOWN);
  const stats = await Promise.all(shown.map((c) => fetchCommitStats(repoName, c.id)));

  const blocks = shown.map((c, i) => {
    const sha     = String(c.id ?? '').slice(0, 7);
    const subject = firstLine(c.message);
    const s       = stats[i];
    const adds    = s?.additions ?? null;
    const dels    = s?.deletions ?? null;
    const totalLn = s?.total ?? null;
    const shaLink = c.url ? `[\`${sha}\`](${c.url})` : `\`${sha}\``;
    // If the API call failed, fall back to file counts so we show *something*.
    const statsLine = (adds != null && dels != null)
      ? `> 🟢 \`+${adds}\`   🔴 \`-${dels}\`   📊 \`${totalLn}\` lines`
      : `> 🟢 \`${(c.added ?? []).length}\` files added   🟡 \`${(c.modified ?? []).length}\` modified   🔴 \`${(c.removed ?? []).length}\` removed`;
    return `> ${shaLink}  **${subject}**\n${statsLine}`;
  });

  const overflow = total > shown.length
    ? `\n\n_…and ${total - shown.length} more_`
    : '';

  const emoji = pick(HEADER_EMOJI);
  const headerLine = compareUrl
    ? `${emoji}  **[${total} new ${total === 1 ? 'commit' : 'commits'}](${compareUrl})** on \`${branch}\``
    : `${emoji}  **${total} new ${total === 1 ? 'commit' : 'commits'}** on \`${branch}\``;

  const desc = `${headerLine}\n\n${blocks.join('\n\n')}${overflow}`;

  return new EmbedBuilder()
    .setColor(pick(VIBRANT_COLORS))
    .setAuthor({
      name: pusher,
      iconURL: avatarUrl ?? undefined,
      url: senderUrl ?? undefined,
    })
    .setDescription(desc.slice(0, 4000))
    .setFooter({ text: 'Dawning' })
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

    const embed = await formatPushEmbed(payload);
    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
    log.info(`posted ${commits.length} commit(s) to changelog (branch=${branch})`);
    return { ok: true };
  } catch (e) {
    log.error('postPushEvent failed:', e);
    return { ok: false, reason: e.message };
  }
}
