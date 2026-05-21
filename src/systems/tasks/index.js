// Background-task scheduler + dispatch table. Three tasks today (expiry,
// decay, promotion). startScheduler() kicks off setInterval loops and returns
// a stop handle for graceful shutdown. runTask(name, ...) is the single entry
// point used by both the scheduler and the on-demand admin paths (Operations
// subpanel button + /admin-trigger-task).

import { runExpiryTask } from './expiry.js';
import { runDecayTask } from './decay.js';
import { runPromotionTask } from './promotion.js';
import { runBountyExpiryTask } from './bounty-expiry.js';
import { runGiveawayDrawTask } from './giveaway-draw.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('tasks');

// name -> { fn(ctx), intervalMs }. The interval values are deliberate:
//   expiry / bounty-expiry: short - per-day or hour TTLs, late DMs hurt
//   decay/promotion: hourly is plenty (resolutions are days/weeks)
export const TASKS = {
  expiry:        { fn: runExpiryTask,       intervalMs: 5 * 60 * 1000 },
  decay:         { fn: runDecayTask,        intervalMs: 60 * 60 * 1000 },
  promotion:     { fn: runPromotionTask,    intervalMs: 60 * 60 * 1000 },
  'bounty-expiry': { fn: runBountyExpiryTask, intervalMs: 60 * 1000 },
  'giveaway-draw': { fn: runGiveawayDrawTask, intervalMs: 30 * 1000 },
};

// Calls TASKS[name].fn with a shared ctx and returns its result. Wraps errors
// so the caller (scheduler tick or admin button) doesn't crash.
export async function runTask(name, ctx) {
  const task = TASKS[name];
  if (!task) throw new Error(`unknown task: ${name}`);
  try {
    const result = await task.fn(ctx);
    return { ok: true, result };
  } catch (e) {
    log.error(`task ${name} failed:`, e);
    return { ok: false, error: e.message };
  }
}

// Starts a setInterval per task. Each tick is independent so a slow run of
// one task doesn't block the others. Returns a stop() handle for shutdown.
export function startScheduler({ discordClient }) {
  const handles = [];
  for (const [name, task] of Object.entries(TASKS)) {
    const tick = () => {
      runTask(name, { discordClient }).catch((e) => log.error(`tick ${name}:`, e));
    };
    // Stagger the initial run by 5s so all three don't slam DB at startup.
    const initial = setTimeout(tick, 5_000);
    const handle = setInterval(tick, task.intervalMs);
    handles.push({ name, initial, handle });
    log.info(`scheduled ${name} every ${task.intervalMs}ms`);
  }
  return () => {
    for (const h of handles) {
      clearTimeout(h.initial);
      clearInterval(h.handle);
    }
    log.info('scheduler stopped');
  };
}
