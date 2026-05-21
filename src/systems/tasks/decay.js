// Strike-decay sweep: for each user with strikes > 0, if they've been "clean"
// (no punish entries) for at least strike_decay_days, decrement strikes by 1
// and bump last_strike_decay_at to now. Re-runs that fall within the same
// window are no-ops.
//
// "Clean since" anchor is the most recent of:
//   - last_strike_decay_at (so we decay at most once per window)
//   - the user row's created_at (lower bound for brand-new sponsors)
// If last_strike_decay_at is null, we treat the most-recent punish timestamp
// as the anchor; sponsorHadStrikeSince() against that already returns false,
// so we use a simpler "decay if strikes>0 and no punish since the last decay
// (or creation)" rule.

import { getUsersWithStrikes, sponsorHadStrikeSince, updateUserFields } from '../../db/queries.js';
import { getSetting } from '../settings/index.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('tasks/decay');

export async function runDecayTask() {
  const decayDays = getSetting('strike_decay_days');
  const windowMs = decayDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const cutoffSince = new Date(now - windowMs);

  const users = await getUsersWithStrikes();
  let decayed = 0;

  for (const u of users) {
    // Anchor: last decay, else creation. If neither (shouldn't happen post-001
    // migration), skip rather than guess.
    const lastDecay = u.last_strike_decay_at ? new Date(u.last_strike_decay_at) : null;
    const created   = u.created_at ? new Date(u.created_at) : null;
    const anchor    = lastDecay ?? created;
    if (!anchor) continue;

    // Not enough time has passed since the last anchor.
    if (now - anchor.getTime() < windowMs) continue;

    // Any punish in the decay window blocks decay this round.
    const since = anchor < cutoffSince ? cutoffSince : anchor;
    const hadStrike = await sponsorHadStrikeSince(u.discord_id, since);
    if (hadStrike) continue;

    const newStrikes = Math.max(0, (u.strikes ?? 0) - 1);
    await updateUserFields(u.discord_id, {
      strikes: newStrikes,
      last_strike_decay_at: new Date(now).toISOString(),
    });
    decayed++;
    log.info(`decay: ${u.discord_id} ${u.strikes} -> ${newStrikes}`);
  }

  log.info(`decay sweep: ${decayed}/${users.length} decremented`);
  return { scanned: users.length, decayed };
}
