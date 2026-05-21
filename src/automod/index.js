// Message auto-moderation. Runs against every guild message we can see
// (requires MessageContent intent). Per-check tunables live in the settings
// system so admins can edit the slur list, trusted domains, spam window,
// etc. from the settings panel without redeploying.
//
// Exemptions:
//   - bot messages
//   - server admins (ADMIN_ROLE_ID)
//   - messages in DMs (modmail handles those separately)
//
// On violation:
//   - delete the message
//   - log a structured embed to ADMIN_LOG_CHANNEL_ID (if set)
//   - optionally DM the user with the reason
//   - optionally time the user out for N minutes

import { Events, EmbedBuilder } from 'discord.js';
import { env } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { getSetting } from '../systems/settings/index.js';
import { isBlocked } from '../utils/blocklist.js';

const log = logger.child('automod');

// ----- text normalisation for slur / bypass detection -----

// Aggressive normaliser. Catches:
//   - lowercase variation
//   - diacritics ("ñïggér" -> "nigger")
//   - leet substitutions (1!|, 0, 3, 4@, 5$, 7, 8)
//   - spacing bypasses ("n i g g e r" -> "nigger")
//   - punctuation insertion ("n.i.g.g.e.r")
// Trade-off: aggressive normalisation produces false positives (e.g. compound
// words can incidentally contain a target substring after stripping). Tune
// the slur list to mitigate.
function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')  // strip combining marks
    .replace(/[1!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[8]/g, 'b')
    .replace(/[^a-z]/g, '');
}

function parseList(setting) {
  const raw = getSetting(setting) || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function matchesSlur(normalizedMessage) {
  const slurs = parseList('automod_slur_list');
  for (const slur of slurs) {
    const n = normalize(slur);
    if (n && normalizedMessage.includes(n)) return slur;
  }
  return null;
}

// ----- link detection -----

const URL_RE = /\bhttps?:\/\/([^\s<>"']+)/gi;
const DISCORD_INVITE_RE = /\b(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;

function extractUrls(text) {
  const out = [];
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    const full = m[0];
    const hostPart = m[1].split(/[\/?#]/)[0].toLowerCase();
    out.push({ full, host: hostPart });
  }
  return out;
}

function isTrustedHost(host, trustedDomains) {
  if (!host) return false;
  return trustedDomains.some((d) => host === d || host.endsWith(`.${d}`));
}

// ----- spam tracker -----

// user_id -> [timestamp_ms, ...]
const recentMessages = new Map();

function recordAndCheckSpam(userId) {
  const max    = getSetting('automod_spam_messages');
  const window = getSetting('automod_spam_window_seconds') * 1000;
  const now = Date.now();
  const cutoff = now - window;
  const arr = (recentMessages.get(userId) ?? []).filter((t) => t > cutoff);
  arr.push(now);
  recentMessages.set(userId, arr);
  return arr.length > max;
}

setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, arr] of recentMessages) {
    const fresh = arr.filter((t) => t > cutoff);
    if (fresh.length === 0) recentMessages.delete(id);
    else recentMessages.set(id, fresh);
  }
}, 60_000).unref();

// ----- core check -----

// Returns { ok: true } or { ok: false, reason, code }.
function evaluateMessage(message) {
  const content = message.content || '';
  const norm = normalize(content);

  // 1. Slurs
  const slurHit = matchesSlur(norm);
  if (slurHit) {
    return { ok: false, code: 'slur', reason: `slur/insult ("${slurHit}")` };
  }

  // 2. Discord invites (separate setting from generic links because they're
  //    almost always self-promo or raid bait, regardless of host trust).
  if (getSetting('automod_block_invites') && DISCORD_INVITE_RE.test(content)) {
    return { ok: false, code: 'invite', reason: 'Discord invite link' };
  }

  // 3. Untrusted links
  if (getSetting('automod_block_untrusted_links')) {
    const trusted = parseList('automod_trusted_domains').map((d) => d.toLowerCase());
    const urls = extractUrls(content);
    for (const u of urls) {
      if (!isTrustedHost(u.host, trusted)) {
        return { ok: false, code: 'link', reason: `link to untrusted domain (${u.host})` };
      }
    }
  }

  // 4. Spam (sliding window)
  if (recordAndCheckSpam(message.author.id)) {
    return { ok: false, code: 'spam', reason: 'message spam (rate)' };
  }

  return { ok: true };
}

// ----- action dispatcher -----

async function actOnViolation(message, verdict, client) {
  // 1. Delete
  let deleted = false;
  try {
    await message.delete();
    deleted = true;
  } catch (e) {
    log.warn(`delete ${message.id}: ${e.message} (likely missing Manage Messages in #${message.channel?.id})`);
  }

  // 2. Warn DM
  if (getSetting('automod_warn_dm')) {
    try {
      await message.author.send(
        `Your message in **${message.guild?.name ?? 'the server'}** was removed by auto-moderation.\n` +
        `**Reason:** ${verdict.reason}\n` +
        `If you think this was a mistake, contact a server admin.`,
      );
    } catch { /* DMs closed; ignore */ }
  }

  // 3. Timeout
  const timeoutMin = getSetting('automod_timeout_minutes');
  if (timeoutMin > 0 && message.member?.moderatable) {
    try {
      await message.member.timeout(timeoutMin * 60 * 1000, `automod: ${verdict.code}`);
    } catch (e) {
      log.warn(`timeout ${message.author.id}: ${e.message}`);
    }
  }

  // 4. Audit log
  if (env.discord.adminLogChannelId) {
    try {
      const channel = await client.channels.fetch(env.discord.adminLogChannelId);
      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`🛡 Automod: ${verdict.code}`)
        .setDescription(verdict.reason)
        .addFields(
          { name: 'User',    value: `<@${message.author.id}> (\`${message.author.tag}\`)`, inline: true },
          { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
          { name: 'Action',  value: [
            deleted ? '✓ deleted' : '✗ delete failed',
            timeoutMin > 0 ? `✓ timed out ${timeoutMin}m` : '— no timeout',
          ].join('\n'), inline: true },
          { name: 'Content', value: '```\n' + String(message.content).slice(0, 1000) + '\n```' },
        )
        .setTimestamp(new Date());
      await channel.send({ embeds: [embed] });
    } catch (e) { log.warn(`audit log: ${e.message}`); }
  }
}

// ----- exemption check -----

function isExempt(message) {
  if (!message.guild) return true;                          // DMs handled elsewhere
  if (message.author?.bot) return true;                     // skip bots (incl. us)
  if (message.system) return true;
  if (isBlocked(message.author.id)) return true;            // already blocked
  // Admins are trusted to post freely.
  if (env.discord.adminRoleId && message.member?.roles?.cache?.has(env.discord.adminRoleId)) {
    return true;
  }
  return false;
}

// ----- public wiring -----

export function registerAutomod(client) {
  client.on(Events.MessageCreate, async (message) => {
    try {
      if (!getSetting('automod_enabled')) return;
      if (isExempt(message)) return;

      const verdict = evaluateMessage(message);
      if (verdict.ok) return;

      log.info(`violation by ${message.author.tag} (${message.author.id}) in #${message.channel.id}: ${verdict.code} — ${verdict.reason}`);
      await actOnViolation(message, verdict, client);
    } catch (e) {
      log.error('automod handler:', e);
    }
  });

  client.on(Events.MessageUpdate, async (_oldMsg, message) => {
    // Re-evaluate edits with the same rules so people can't sneak content in
    // post-send. Discord delivers a partial sometimes; refetch if needed.
    try {
      if (!getSetting('automod_enabled')) return;
      if (message.partial) {
        try { message = await message.fetch(); } catch { return; }
      }
      if (isExempt(message)) return;
      const verdict = evaluateMessage(message);
      if (verdict.ok) return;
      log.info(`edit-violation by ${message.author.tag} in #${message.channel.id}: ${verdict.code}`);
      await actOnViolation(message, verdict, client);
    } catch (e) {
      log.error('automod edit handler:', e);
    }
  });

  log.info('automod registered (enable via the settings panel: automod_enabled)');
}
