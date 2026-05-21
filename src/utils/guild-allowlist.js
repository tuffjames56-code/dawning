// Anti-leech: this bot instance can only operate in a specific allow-list of
// guild IDs. Anything else, it leaves on join and ignores interactions from
// in the meantime. Prevents anyone from inviting a pre-built copy of the bot
// to a foreign server where it would still be talking to the original
// owner's database / MC server / RCON.
//
// The allow-list defaults to DISCORD_GUILD_ID. Self-hosters who actually
// want multi-guild support can set ALLOWED_GUILD_IDS=a,b,c explicitly.

import { Events } from 'discord.js';
import { env } from './config.js';
import { logger } from './logger.js';

const log = logger.child('guild-allowlist');

function getAllowed() {
  const raw = env.discord.allowedGuildIds || env.discord.guildId || '';
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function isAllowed(guildId) {
  if (!guildId) return false;
  return getAllowed().has(guildId);
}

export function registerGuildAllowlist(client) {
  const allowed = getAllowed();
  if (allowed.size === 0) {
    log.warn('no allowed guilds configured; allow-list disabled (set DISCORD_GUILD_ID or ALLOWED_GUILD_IDS)');
    return;
  }
  log.info(`allow-list active: ${[...allowed].join(', ')}`);

  // Audit guilds the bot is already in (e.g. carry-over from a previous run).
  client.once(Events.ClientReady, async () => {
    try {
      const guilds = await client.guilds.fetch();
      for (const [id] of guilds) {
        if (!allowed.has(id)) await leaveForeign(client, id, 'startup audit');
      }
    } catch (e) { log.warn(`startup audit: ${e.message}`); }
  });

  // Auto-leave on future invites.
  client.on(Events.GuildCreate, async (guild) => {
    if (allowed.has(guild.id)) return;
    log.warn(`bot added to unauthorized guild ${guild.id} ("${guild.name}"); leaving`);
    await leaveForeign(client, guild.id, 'unauthorized guildCreate', guild);
  });

  // Defense-in-depth: ignore interactions from foreign guilds. The guildCreate
  // handler should remove the bot before any interaction fires here, but
  // there can be a small window during which someone clicks something.
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.guildId) return;
    if (allowed.has(interaction.guildId)) return;
    try {
      if (interaction.isRepliable && interaction.isRepliable()) {
        await interaction.reply({
          content: 'This bot is host-locked to a specific server. To use it in yours, deploy your own instance — see the GitHub repo.',
          flags: 64, // ephemeral
        });
      }
    } catch { /* swallow */ }
  });
}

async function leaveForeign(client, guildId, reason, cachedGuild = null) {
  try {
    const guild = cachedGuild ?? await client.guilds.fetch(guildId);

    // Best-effort DM to the inviter so they understand why the bot vanished.
    try {
      const owner = await guild.fetchOwner();
      await owner.send(
        `Hi — this Discord bot is **host-locked** to a specific server (${reason}). ` +
        `If you'd like to use it on your own server, the source code is public; ` +
        `deploy your own instance and the allow-list will accept it. Take care.`,
      );
    } catch { /* DMs closed */ }

    await guild.leave();
    log.info(`left unauthorized guild ${guildId} (${reason})`);
  } catch (e) {
    log.warn(`couldn't leave ${guildId}: ${e.message}`);
  }
}
