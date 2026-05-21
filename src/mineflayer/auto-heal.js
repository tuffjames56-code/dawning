// Keep the bot alive while it sits around the deposit area. When hp drops
// below 5 hearts, fire vanilla effects to refill HP + hunger:
//   - instant_health amplifier 100 (heals to max instantly)
//   - saturation amplifier 10     (refills food + saturation)
//   - resistance amplifier 4 for 10s (soaks the next damage bursts)
//
// These are vanilla 1.20+ effect IDs and work via RCON without any plugin.
// Cooldown prevents RCON spam when damage ticks in quickly.

import { mc } from './bot.js';
import { mcEffect } from './commands.js';
import { logger } from '../utils/logger.js';

const log = logger.child('mineflayer/auto-heal');

const HEAL_THRESHOLD_HP = 10;   // 5 hearts
const HEAL_COOLDOWN_MS  = 3000;

let lastHealAt = 0;

async function fullHeal(botName) {
  // Order matters: HP first (in case the bot is about to die this tick),
  // then food, then resistance for the next few seconds.
  await mcEffect(botName, 'minecraft:instant_health', 1, 100).catch((e) => log.warn(`instant_health: ${e.message}`));
  await mcEffect(botName, 'minecraft:saturation',     1, 10).catch((e) => log.warn(`saturation: ${e.message}`));
  await mcEffect(botName, 'minecraft:resistance',    10,  4).catch((e) => log.warn(`resistance: ${e.message}`));
}

export function registerAutoHeal() {
  mc.on('ready', ({ bot }) => {
    lastHealAt = 0;

    bot.on('health', () => {
      if (typeof bot.health !== 'number') return;
      if (bot.health > HEAL_THRESHOLD_HP) return;

      const now = Date.now();
      if (now - lastHealAt < HEAL_COOLDOWN_MS) return;
      lastHealAt = now;

      log.info(`auto-heal: hp=${bot.health.toFixed(1)} food=${bot.food ?? '?'} — applying effects`);
      fullHeal(bot.username).catch((e) => log.warn(`auto-heal failed: ${e.message}`));
    });

    bot.on('death', () => {
      log.warn(`bot died at hp=${bot.health}; mineflayer auto-respawns by default`);
    });
  });
}
