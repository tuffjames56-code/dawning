// Two-way chat bridge between MC public chat and a configured Discord channel.
//
//   MC chat from a player    -> Discord channel as "<player> <message>"
//   Discord message in bridge -> MC chat as "[Discord] <username>: <message>"
//
// Loop prevention:
//   - The mc wrapper already skips chat lines from the bot itself.
//   - The Discord listener skips messages from bots (including ourselves).
//
// Live toggle: `bridge_enabled` setting. Channel: `bridge_channel_id`.

import { Events } from 'discord.js';
import { mc } from '../mineflayer/bot.js';
import { getSetting } from '../systems/settings/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('bridge');

const MAX_MC_CHARS = 200;  // leave headroom under MC's 256-char chat cap

function sanitiseForMc(text) {
  // Strip newlines + any leading slash so we don't accidentally fire a
  // server command via the bot's OP context.
  return String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^\/+/, '')
    .slice(0, MAX_MC_CHARS);
}

function sanitiseForDiscord(text) {
  // Suppress @everyone/@here/role pings from in-game players.
  return String(text ?? '')
    .replaceAll('@everyone', '@​everyone')
    .replaceAll('@here',     '@​here')
    .slice(0, 1900);
}

export function registerBridge(discordClient) {
  // MC -> Discord
  mc.on('chat', async ({ username, message }) => {
    try {
      if (!getSetting('bridge_enabled')) return;
      const channelId = getSetting('bridge_channel_id');
      if (!channelId) return;
      const channel = await discordClient.channels.fetch(channelId).catch(() => null);
      if (!channel) return;

      const display = String(username).replace(/^\./, '');
      const body = sanitiseForDiscord(message);
      if (!body.trim()) return;
      await channel.send({
        content: `**${display}**: ${body}`,
        allowedMentions: { parse: [] },
      });
    } catch (e) { log.warn(`mc->discord: ${e.message}`); }
  });

  // Discord -> MC
  discordClient.on(Events.MessageCreate, async (message) => {
    try {
      if (!getSetting('bridge_enabled')) return;
      const channelId = getSetting('bridge_channel_id');
      if (!channelId || message.channel?.id !== channelId) return;
      if (message.author.bot) return;                       // skip our own + other bots
      if (!mc.bot) return;                                  // bot disconnected
      const body = sanitiseForMc(message.content);
      if (!body.trim()) return;
      mc.bot.chat(`[Discord] ${message.member?.displayName ?? message.author.username}: ${body}`);
    } catch (e) { log.warn(`discord->mc: ${e.message}`); }
  });

  log.info('bridge registered (toggle bridge_enabled in settings to activate)');
}
