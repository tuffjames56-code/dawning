import { Client, GatewayIntentBits, Events, MessageFlags, Partials } from 'discord.js';
import { env } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { commands } from '../commands/index.js';
import { buttonHandlers, modalHandlers, selectMenuHandlers, resolveHandler } from '../panels/registry.js';
import { isBlocked } from '../utils/blocklist.js';

const log = logger.child('discord');

// Intent picks:
//   Guilds            - always required for slash commands
//   GuildMessages     - panel handlers + modmail message forwarding
//   DirectMessages    - we DM users link codes / bounty alerts + modmail inbox
//   MessageContent    - privileged; required so we can read message text in
//                       modmail (DMs, @-mentions, admin replies in threads).
//                       Enable it in the Discord developer portal under
//                       "Bot" → "Privileged Gateway Intents".
// Partials.Channel    - required to receive DM events
// Partials.Message    - lets us see uncached messages (older threads etc.)
export function buildDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,   // welcome/goodbye + accurate roles cache
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
  });

  client.once(Events.ClientReady, (c) => {
    log.info(`logged in as ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // Bot blocklist gate. Blocked users get a single ephemeral reply on
      // anything they click / type so they know why the bot is silent.
      if (isBlocked(interaction.user?.id)) {
        log.info(`ignored interaction from blocked user ${interaction.user?.id}`);
        try {
          if (!interaction.replied && !interaction.deferred && interaction.isRepliable?.()) {
            await interaction.reply({
              content: 'You are blocked from using this bot.',
              flags: MessageFlags.Ephemeral,
            });
          }
        } catch { /* swallow */ }
        return;
      }

      if (interaction.isChatInputCommand()) {
        const cmd = commands.get(interaction.commandName);
        if (!cmd) {
          log.warn(`unknown command: ${interaction.commandName}`);
          return;
        }
        await cmd.execute(interaction);
        return;
      }
      if (interaction.isButton()) {
        const m = resolveHandler(buttonHandlers, interaction.customId);
        if (!m) { log.warn(`no handler for button: ${interaction.customId}`); return; }
        await m.handler(interaction, ...m.args);
        return;
      }
      if (interaction.isModalSubmit()) {
        const m = resolveHandler(modalHandlers, interaction.customId);
        if (!m) { log.warn(`no handler for modal: ${interaction.customId}`); return; }
        await m.handler(interaction, ...m.args);
        return;
      }
      if (interaction.isStringSelectMenu()) {
        const m = resolveHandler(selectMenuHandlers, interaction.customId);
        if (!m) { log.warn(`no handler for select: ${interaction.customId}`); return; }
        await m.handler(interaction, ...m.args);
        return;
      }
    } catch (err) {
      log.error('interaction error:', err);
      const payload = { content: 'Something went wrong handling that.', ephemeral: true };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch (e) { log.error('failed to send error reply:', e.message); }
    }
  });

  return client;
}

export async function startDiscord() {
  const client = buildDiscordClient();
  await client.login(env.discord.token);
  return client;
}
