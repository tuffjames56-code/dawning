// Modmail: users DM or @-mention the bot; the message gets forwarded into
// a per-user thread inside MODMAIL_CHANNEL_ID. Admins reply directly inside
// that thread and the bot relays their message back to the user as a DM.
//
// State model:
//   in-memory cache  discord_user_id -> thread_id
//   rehydrated on startup by scanning the channel's active + archived threads
//   for a name suffix "(<user_id>)"  -- so thread state survives restarts
//   without needing a DB table.
//
// Inbound (user -> admin):
//   - messageCreate where channel.isDMBased(), author is human, content non-empty
//   - messageCreate where guild present, bot is mentioned, author is human
// Outbound (admin -> user):
//   - messageCreate where channel.isThread(), parent is MODMAIL_CHANNEL_ID,
//     author is human (not the bot), thread name has the user id suffix
//
// Privileged intents required: MessageContent (see src/bot/client.js).

import { Events, EmbedBuilder, ChannelType } from 'discord.js';
import { env } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { isBlocked } from '../utils/blocklist.js';

const log = logger.child('modmail');

const userToThread = new Map(); // user_id -> thread_id

// Match the trailing "(123456789)" we put on every thread we create so we
// can recover the user id without a DB lookup.
const THREAD_USER_ID_RE = /\((\d{15,22})\)\s*$/;

function isModmailConfigured() {
  return !!env.discord.modmailChannelId;
}

async function getChannel(client) {
  try {
    return await client.channels.fetch(env.discord.modmailChannelId);
  } catch (e) {
    log.warn(`modmail channel fetch failed: ${e.message}`);
    return null;
  }
}

async function rehydrateThreads(client) {
  const channel = await getChannel(client);
  if (!channel || !channel.threads) return;
  try {
    const active = await channel.threads.fetchActive();
    for (const [, t] of active.threads) addToCache(t);
    const archived = await channel.threads.fetchArchived({ limit: 100 });
    for (const [, t] of archived.threads) addToCache(t);
  } catch (e) { log.warn(`rehydrate threads failed: ${e.message}`); }
  log.info(`modmail rehydrated ${userToThread.size} threads`);
}

function addToCache(thread) {
  const m = THREAD_USER_ID_RE.exec(thread?.name ?? '');
  if (m) userToThread.set(m[1], thread.id);
}

async function findOrCreateThread(client, user) {
  const channel = await getChannel(client);
  if (!channel) return null;

  const cachedId = userToThread.get(user.id);
  if (cachedId) {
    try {
      const t = await channel.threads.fetch(cachedId);
      if (t && !t.archived) return t;
      if (t && t.archived) { await t.setArchived(false, 'new modmail message'); return t; }
    } catch { /* fall through to create */ }
    userToThread.delete(user.id);
  }

  const name = `📬 ${user.username} (${user.id})`.slice(0, 100);
  try {
    const thread = await channel.threads.create({
      name,
      autoArchiveDuration: 4320, // 3 days
      type: ChannelType.PublicThread,
      reason: 'modmail',
    });
    userToThread.set(user.id, thread.id);
    log.info(`opened modmail thread ${thread.id} for ${user.tag} (${user.id})`);
    return thread;
  } catch (e) {
    log.warn(`couldn't create modmail thread for ${user.id}: ${e.message}`);
    return null;
  }
}

function attachmentsBlock(message) {
  const urls = [...message.attachments.values()].map((a) => a.url);
  return urls.length ? `\n**Attachments:** ${urls.join(', ')}` : '';
}

async function forwardInbound(client, message) {
  const thread = await findOrCreateThread(client, message.author);
  if (!thread) return;

  const source = message.guild
    ? `@-mentioned in <#${message.channel.id}>`
    : 'direct message';
  const content = message.content?.trim() || '_(no text)_';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({
      name: `${message.author.tag} (${message.author.id})`,
      iconURL: message.author.displayAvatarURL?.() ?? null,
    })
    .setDescription(content.slice(0, 4000))
    .setFooter({ text: source })
    .setTimestamp(new Date(message.createdTimestamp ?? Date.now()));

  const extras = attachmentsBlock(message);
  await thread.send({
    content: extras || null,
    embeds: [embed],
  });
}

async function relayAdminReply(client, message) {
  // Channel must be a thread under MODMAIL_CHANNEL_ID.
  if (!message.channel?.isThread?.()) return;
  if (message.channel.parentId !== env.discord.modmailChannelId) return;

  // Recover the user id from the thread name; if it isn't a modmail thread
  // (someone created an ad-hoc thread in this channel), ignore.
  const m = THREAD_USER_ID_RE.exec(message.channel.name ?? '');
  if (!m) return;
  const userId = m[1];

  // Don't relay bot messages or system messages.
  if (message.author?.bot) return;
  if (!message.content && message.attachments.size === 0) return;

  // Don't relay messages that start with '.' — convention for thread notes
  // that should NOT be sent to the user.
  if (message.content?.startsWith('.')) {
    await message.react('🤫').catch(() => {});
    return;
  }

  try {
    const user = await client.users.fetch(userId);
    const extras = attachmentsBlock(message);
    const body = (message.content || '').slice(0, 1900);
    // Anonymous relay: no admin attribution in the user-facing DM. The
    // thread itself still shows who sent each reply for internal context.
    await user.send(`${body}${extras}`);
    await message.react('✅').catch(() => {});
  } catch (e) {
    log.warn(`relay to ${userId} failed: ${e.message}`);
    await message.react('❌').catch(() => {});
    try {
      await message.reply(`Couldn't deliver: ${e.message}`);
    } catch { /* noop */ }
  }
}

// ---------- public entrypoint ----------

export function registerModmail(client) {
  if (!isModmailConfigured()) {
    log.info('modmail disabled (MODMAIL_CHANNEL_ID not set)');
    return;
  }

  client.once(Events.ClientReady, () => {
    rehydrateThreads(client).catch((e) => log.warn(`rehydrate: ${e.message}`));
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      // Skip our own messages.
      if (message.author?.id === client.user?.id) return;
      // Skip system messages.
      if (message.system) return;

      // DM from a human → forward (unless blocked).
      if (message.channel?.isDMBased?.() && !message.author?.bot) {
        if (isBlocked(message.author.id)) {
          log.info(`ignored DM from blocked user ${message.author.id}`);
          return;
        }
        await forwardInbound(client, message);
        return;
      }

      // Guild message that @-mentions the bot → forward (unless blocked).
      if (message.guild && !message.author?.bot && message.mentions?.users?.has(client.user.id)) {
        if (isBlocked(message.author.id)) {
          log.info(`ignored @-mention from blocked user ${message.author.id}`);
          return;
        }
        await forwardInbound(client, message);
        return;
      }

      // Reply inside a modmail thread → relay to user.
      if (message.guild && message.channel?.isThread?.()) {
        await relayAdminReply(client, message);
        return;
      }
    } catch (e) {
      log.error('modmail handler error:', e);
    }
  });

  log.info(`modmail registered (channel ${env.discord.modmailChannelId})`);
}
