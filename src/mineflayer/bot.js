import mineflayer from 'mineflayer';
import { EventEmitter } from 'node:events';
import { env } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const log = logger.child('mineflayer');

// Mineflayer's `bot` instance is recreated on every (re)connect, which makes
// "subscribe once, survive reconnects" awkward. We wrap it in an EventEmitter
// so consumers register against `mc` once and we re-pipe events on each spawn.
//
// Events re-emitted:
//   ready     - first 'spawn' after each (re)connect; payload: { bot }
//   chat      - { username, message, bot }    (public player chat, filters self)
//   whisper   - { username, message, bot }    (private message TO the bot)
//   message   - { message, position, bot }    (ALL incoming chat lines, including
//                                              system / tellraw messages from mods.
//                                              `position` is 'chat'|'system'|'game_info')
//   end       - underlying disconnect (raw reason)
//
// `mc.bot` is the current live mineflayer bot, or null if disconnected.
// Sub-systems should ALWAYS read `mc.bot` at call time, never cache it.
class McBot extends EventEmitter {
  constructor() {
    super();
    this.bot = null;
    this._reconnectAttempts = 0;
    this._stopped = false;
  }

  start() {
    this._stopped = false;
    this._spawnBot();
  }

  stop() {
    this._stopped = true;
    if (this.bot) {
      try { this.bot.quit('shutdown'); } catch { /* noop */ }
      this.bot = null;
    }
  }

  _spawnBot() {
    log.info(`connecting to ${env.mc.host}:${env.mc.port} as ${env.mc.username}`);
    const bot = mineflayer.createBot({
      host: env.mc.host,
      port: env.mc.port,
      username: env.mc.username,
      auth: env.mc.auth,
      version: false,            // auto-detect
      keepAlive: true,             // we still respond to inbound keepalives
      // Effectively disable the client-side keepalive watchdog. The server's
      // keepalive cadence on this modded setup is unreliable (sometimes >90s
      // between packets) and we'd rather let the TCP socket itself detect a
      // truly dead connection via 'end' / 'error' than disconnect ourselves
      // every couple of minutes. 24h is "never" for our purposes.
      checkTimeoutInterval: 24 * 60 * 60 * 1000,
    });
    this.bot = bot;

    bot.once('spawn', () => {
      this._reconnectAttempts = 0;
      log.info(`spawned as ${bot.username} (uuid=${bot.player?.uuid ?? '?'})`);
      this.emit('ready', { bot });
    });

    bot.on('chat', (username, message) => {
      if (username === bot.username) return; // ignore self
      this.emit('chat', { username, message, bot });
    });

    bot.on('whisper', (username, message) => {
      if (username === bot.username) return;
      this.emit('whisper', { username, message, bot });
    });

    // Mineflayer's `messagestr` fires for every chat-related packet, including
    // tellraw/system messages from mods (TPA notifications, death messages
    // when the bot isn't the speaker, etc.). The `chat` event above only
    // fires for player-speaker lines, so without this, mod-generated lines
    // are invisible to us.
    bot.on('messagestr', (message, position) => {
      this.emit('message', { message, position, bot });
    });

    // Mineflayer emits 'end' on TCP close, 'kicked' on server kick, 'error' on protocol errors.
    // Any of them means we lost the connection; reconnect with backoff.
    const handleDown = (reason) => {
      log.warn(`disconnected: ${reason}`);
      this.bot = null;
      this.emit('end', reason);
      if (!this._stopped) this._scheduleReconnect();
    };
    bot.on('end',    (r) => handleDown(`end: ${r}`));
    bot.on('kicked', (r) => handleDown(`kicked: ${typeof r === 'string' ? r : JSON.stringify(r)}`));
    bot.on('error',  (e) => log.error('bot error:', e.message));
  }

  _scheduleReconnect() {
    // Capped exponential: 2s, 4s, 8s, ... up to 60s.
    const attempt = ++this._reconnectAttempts;
    const delay = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
    log.info(`reconnecting in ${delay}ms (attempt ${attempt})`);
    setTimeout(() => { if (!this._stopped) this._spawnBot(); }, delay);
  }
}

export const mc = new McBot();
