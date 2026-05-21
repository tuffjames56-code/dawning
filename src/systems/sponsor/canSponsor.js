// Gatekeeper for the sponsor-someone flow. The same helper backs the panel
// button AND any future "user-initiated" sponsor surfaces. Admin force-sponsor
// intentionally bypasses this.
//
// Returns { allowed: bool, reason: string|null }.

import { getUserByDiscord, getActiveSponseesOf } from '../../db/queries.js';
import { getSetting } from '../settings/index.js';

export async function canSponsor(discordId) {
  const user = await getUserByDiscord(discordId);

  // 1. Trusted-only.
  if (!user || user.status !== 'trusted') {
    return { allowed: false, reason: 'Only trusted members can sponsor.' };
  }

  // 2. Capacity.
  const max = getSetting('max_active_sponsees');
  const sponsees = await getActiveSponseesOf(discordId);
  if (sponsees.length >= max) {
    return {
      allowed: false,
      reason:
        `You're already sponsoring ${sponsees.length}/${max} people. Wait for one to graduate ` +
        `to Trusted (${getSetting('auto_promote_days')} days clean) or remove a sponsorship first.`,
    };
  }

  // 3. Removal cooldown (set when sponsor removes a sponsorship OR by strike suspension).
  if (user.next_sponsor_at) {
    const cooldown = new Date(user.next_sponsor_at);
    if (cooldown.getTime() > Date.now()) {
      const unix = Math.floor(cooldown.getTime() / 1000);
      return { allowed: false, reason: `You recently removed a sponsorship. You can sponsor again <t:${unix}:R>.` };
    }
  }

  // 4. Strike suspension. (Suspension via next_sponsor_at above handles the
  // timed lockout; this is the threshold check for when strikes just crossed
  // the line and we're between strike write + next_sponsor_at write.)
  if ((user.strikes ?? 0) >= getSetting('strike_threshold_suspend')) {
    return { allowed: false, reason: 'Your sponsoring privileges are suspended due to strikes.' };
  }

  // 5. Maintenance gate.
  if (getSetting('maintenance_mode')) {
    return { allowed: false, reason: 'Sponsoring is currently in maintenance mode.' };
  }

  return { allowed: true, reason: null };
}
