// Auto-promote sponsees to trusted once they've been clean for
// auto_promote_days AND their sponsor was also clean over that same window.
// "Clean" = no strike entries in sponsor_logs for the sponsor since the
// sponsorship started.
//
// The double-check (sponsor side) is the "clean-window" rule from the spec:
// promoting a sponsee while their sponsor is racking up strikes would be a
// bad signal, so we hold back.

import {
  getPromotableSponsees,
  sponsorHadStrikeSince,
} from '../../db/queries.js';
import { promoteToTrusted } from '../sponsor/actions.js';
import { getSetting } from '../settings/index.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('tasks/promotion');

export async function runPromotionTask({ discordClient }) {
  const autoPromoteDays = getSetting('auto_promote_days');
  const candidates = await getPromotableSponsees(autoPromoteDays);

  let promoted = 0;
  let blocked  = 0;
  for (const sponsee of candidates) {
    try {
      // Sponsor's clean-window check. If there's no sponsor row recorded
      // (admin force-sponsor without one?), promote unconditionally.
      const sponsorId = sponsee.sponsor_discord_id;
      const since = sponsee.sponsored_at ? new Date(sponsee.sponsored_at) : new Date(0);
      if (sponsorId) {
        const dirty = await sponsorHadStrikeSince(sponsorId, since);
        if (dirty) {
          blocked++;
          log.info(`promote skipped (sponsor dirty): ${sponsee.discord_id} (sponsor=${sponsorId})`);
          continue;
        }
      }

      await promoteToTrusted({
        userId: sponsee.discord_id,
        discordClient,
        actor: 'system',
        source: 'auto',
      });
      promoted++;
    } catch (e) {
      log.warn(`promote ${sponsee.discord_id}: ${e.message}`);
    }
  }

  log.info(`promotion sweep: ${promoted}/${candidates.length} promoted, ${blocked} blocked by sponsor strikes`);
  return { scanned: candidates.length, promoted, blocked };
}
