// Sweep active bounties past their expires_at and refund items via the
// shared expireBounty path.

import { getExpirableBounties } from '../../db/queries.js';
import { expireBounty } from '../bounty/actions.js';
import { sweepExpiredDeposits } from '../bounty/deposit.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('tasks/bounty-expiry');

export async function runBountyExpiryTask({ discordClient }) {
  const expirable = await getExpirableBounties();
  let expired = 0;
  for (const b of expirable) {
    try {
      const result = await expireBounty({ bountyId: b.id, discordClient });
      if (result.ok) expired++;
    } catch (e) {
      log.warn(`expire bounty #${b.id}: ${e.message}`);
    }
  }
  const depositSweep = await sweepExpiredDeposits({ discordClient }).catch((e) => {
    log.warn(`deposit sweep failed: ${e.message}`);
    return { reaped: 0, walked_away: 0 };
  });
  log.info(`bounty expiry: ${expired}/${expirable.length}, deposits reaped: ${depositSweep.reaped}, walked away: ${depositSweep.walked_away ?? 0}`);
  return {
    scanned:         expirable.length,
    expired,
    deposits_reaped: depositSweep.reaped,
    walked_away:     depositSweep.walked_away ?? 0,
  };
}
