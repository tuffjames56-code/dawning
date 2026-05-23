import { startDiscord } from './src/bot/client.js';
import { mc } from './src/mineflayer/bot.js';
import { registerLinking } from './src/systems/linking/index.js';
import { startApiServer } from './src/api/server.js';
import { cleanupExpiredLinkCodes } from './src/db/queries.js';
import { rconClose, probeRcon } from './src/rcon/client.js';
import { logger } from './src/utils/logger.js';
import { registerDefaults } from './src/systems/settings/defaults.js';
import { initSettings } from './src/systems/settings/index.js';
import { initBlocklist } from './src/utils/blocklist.js';
import { startScheduler } from './src/systems/tasks/index.js';
import { registerDepositFlow } from './src/systems/bounty/deposit.js';
import { registerDeathListener } from './src/systems/bounty/death-listener.js';
import { registerAutoHeal } from './src/mineflayer/auto-heal.js';
import { registerModmail } from './src/modmail/index.js';
import { registerAutomod } from './src/automod/index.js';
import { registerWelcomer } from './src/welcomer/index.js';
import { registerBridge } from './src/bridge/index.js';
import { registerGuildAllowlist } from './src/utils/guild-allowlist.js';
import { REST, Routes } from 'discord.js';
import { env } from './src/utils/config.js';
import { commandData } from './src/commands/index.js';
import './src/panels/index.js'; // side-effect: register panel button/modal handlers

const log = logger.child('main');

async function main() {
  log.info('starting bot...');

  // Settings MUST be loaded before anything that calls getSetting(). All
  // call sites are inside request handlers (commands, button clicks, HTTP
  // routes), so this completes before any of them fire.
  registerDefaults();
  await initSettings();
  await initBlocklist();

  // Probe RCON once at boot so the operator can see which transport will
  // serve server-side commands. Non-blocking: failure falls back to mineflayer.
  probeRcon()
    .then((r) => {
      if (r.status === 'ok')          log.info(`RCON OK — using as primary transport. server says: ${r.response}`);
      else if (r.status === 'unavailable') log.warn(`RCON unavailable (${r.error}); using in-game bot as fallback`);
      else                            log.info('RCON not configured; using in-game bot for all commands');
    })
    .catch(() => { /* probe is best-effort */ });

  // Optional: auto-register slash commands on boot when AUTO_REGISTER_COMMANDS=true.
  // Lets you push code + add the env var on Railway to publish commands
  // without running `npm run register` locally. Flip it back off after to
  // skip the extra API call on every redeploy.
  if (process.env.AUTO_REGISTER_COMMANDS === 'true') {
    try {
      const rest = new REST({ version: '10' }).setToken(env.discord.token);
      log.info(`auto-registering ${commandData.length} slash commands to guild ${env.discord.guildId}...`);
      await rest.put(
        Routes.applicationGuildCommands(env.discord.clientId, env.discord.guildId),
        { body: commandData },
      );
      log.info('slash commands registered.');
    } catch (e) {
      log.error('auto-register failed:', e?.message ?? e);
    }
  }

  const discord = await startDiscord();

  // Anti-leech: leave any guild that isn't on the allow-list. Registered
  // first so foreign guilds are dropped before other handlers can fire.
  registerGuildAllowlist(discord);

  // Modmail registers ClientReady + MessageCreate handlers. Must be set up
  // before / right after login so first messages aren't missed.
  registerModmail(discord);

  // Auto-moderation — runs on every guild message we can see.
  registerAutomod(discord);

  // Welcome / goodbye announcer (uses GuildMembers intent).
  registerWelcomer(discord);

  // MC ↔ Discord chat bridge.
  registerBridge(discord);

  // Phase 2: linking is done via HTTP from the verify-mod. The whisper-based
  // handler is a no-op stub but the call is kept so future features can re-use it.
  registerLinking(discord);

  // Phase 3 (bounty): listeners need to be registered BEFORE mc.start() so
  // they catch the first 'ready' event, but mineflayer reconnects automatically
  // and our wrapper re-emits, so registering after mc.start() also works.
  registerDepositFlow(discord);
  registerDeathListener(discord);
  registerAutoHeal();
  mc.start();

  // HTTP server for the verify-mod -> bot bridge.
  const api = startApiServer(discord);

  // Janitor for expired link codes.
  const interval = setInterval(() => {
    cleanupExpiredLinkCodes().catch((e) => log.warn('link code cleanup failed:', e.message));
  }, 5 * 60 * 1000);

  // Sponsor-system background tasks (request expiry, strike decay, auto-promote).
  const stopScheduler = startScheduler({ discordClient: discord });

  // Bot-readiness check. All sponsor + bounty server-side commands flow
  // through the in-game bot; surface its login status so the admin can tell
  // whether commands will actually work right now.
  mc.once('ready', ({ bot }) => {
    log.info(`mineflayer ready as ${bot.username} — server-side commands online (in-game OP required)`);
  });

  const shutdown = async (sig) => {
    log.info(`received ${sig}, shutting down...`);
    clearInterval(interval);
    stopScheduler();
    mc.stop();
    try { api.close(); } catch { /* noop */ }
    try { await discord.destroy(); } catch { /* noop */ }
    await rconClose();
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (e) => log.error('unhandledRejection:', e));
  process.on('uncaughtException',  (e) => log.error('uncaughtException:',  e));
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
