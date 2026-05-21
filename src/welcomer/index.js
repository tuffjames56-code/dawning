// Welcome + goodbye announcer. All tunables (channel, message, on/off) live
// in the settings panel, so flipping them at runtime works without a restart.
//
// Placeholders in the message template:
//   {user}     -> "<@id>" mention
//   {username} -> raw username (no mention)
//   {server}   -> guild name
//   {count}    -> live member count (post-join / post-leave)

import { Events } from 'discord.js';
import { getSetting } from '../systems/settings/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('welcomer');

function render(template, { user, server, count }) {
  return String(template ?? '')
    .replaceAll('{user}',     user ? `<@${user.id}>` : '?')
    .replaceAll('{username}', user?.username ?? '?')
    .replaceAll('{server}',   server?.name ?? '?')
    .replaceAll('{count}',    String(count ?? '?'));
}

async function post(client, channelId, text) {
  if (!channelId || !text) return;
  try {
    const channel = await client.channels.fetch(channelId);
    await channel.send({ content: text, allowedMentions: { users: [], roles: [] } });
  } catch (e) { log.warn(`post to ${channelId}: ${e.message}`); }
}

export function registerWelcomer(client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      if (!getSetting('welcome_enabled')) return;
      const text = render(getSetting('welcome_message'), {
        user:   member.user,
        server: member.guild,
        count:  member.guild.memberCount,
      });
      await post(client, getSetting('welcome_channel_id'), text);
    } catch (e) { log.warn(`welcome handler: ${e.message}`); }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      if (!getSetting('goodbye_enabled')) return;
      const text = render(getSetting('goodbye_message'), {
        user:   member.user,
        server: member.guild,
        count:  member.guild.memberCount,
      });
      await post(client, getSetting('goodbye_channel_id'), text);
    } catch (e) { log.warn(`goodbye handler: ${e.message}`); }
  });

  log.info('welcomer registered (set welcome_enabled / goodbye_enabled in settings to activate)');
}
