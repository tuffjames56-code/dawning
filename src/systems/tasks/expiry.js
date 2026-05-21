// Sweep pending sponsor_requests whose expires_at has passed and run them
// through the shared expireRequest path. Idempotent: claimSponsorRequest's
// WHERE status='pending' guards against double-expiry if two runs race.

import { getExpirableSponsorRequests } from '../../db/queries.js';
import { expireRequest } from '../sponsor/request-actions.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('tasks/expiry');

export async function runExpiryTask({ discordClient }) {
  const expirable = await getExpirableSponsorRequests();
  let expired = 0;
  for (const req of expirable) {
    try {
      const result = await expireRequest({ request: req, discordClient });
      if (result.ok) expired++;
    } catch (e) {
      log.warn(`expire #${req.id}: ${e.message}`);
    }
  }
  log.info(`expiry sweep: ${expired}/${expirable.length} expired`);
  return { scanned: expirable.length, expired };
}
