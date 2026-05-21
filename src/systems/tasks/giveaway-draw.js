// Sweep active giveaways whose ends_at has passed and draw winners via the
// shared drawGiveaway path. Runs every 30s alongside the other scheduler
// tasks.

import { getExpirableGiveaways } from '../../db/queries.js';
import { drawGiveaway } from '../giveaways/actions.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('tasks/giveaway-draw');

export async function runGiveawayDrawTask({ discordClient }) {
  const due = await getExpirableGiveaways();
  let drawn = 0;
  for (const g of due) {
    try {
      const r = await drawGiveaway({ discordClient, giveawayId: g.id, force: false });
      if (r.ok) drawn++;
    } catch (e) {
      log.warn(`draw #${g.id}: ${e.message}`);
    }
  }
  log.info(`giveaway draw sweep: ${drawn}/${due.length}`);
  return { scanned: due.length, drawn };
}
