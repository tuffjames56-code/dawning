// Watches public chat for vanilla / mod death messages and, when a bountied
// target is killed by another player, calls markBountyCompleted with the
// killer's discord id (or null if the killer isn't linked yet).
//
// !!! BLOCKED ON OPEN QUESTION #1 !!!
// The exact in-game death message format on the owner's modded Fabric 26.1.2
// server has not been confirmed. The regex set below covers the *vanilla*
// formats. If your modded server emits different lines (translated, prefixed,
// or with mod brand text), capture one literal example per cause and update
// PLAYER_KILL_RE / PROJECTILE_KILL_RE.
//
// What we deliberately do NOT trigger on:
//   - mob kills (no player credit)
//   - environment deaths (fall, drowning, lava) - "no killer to pay"
//   - self-inflicted (TNT lit by self, etc.)
// If you want some of these to count toward payout, add them in matchKill.

import { mc } from '../../mineflayer/bot.js';
import {
  getActiveBountiesByTarget,
  getUserByMcName,
  setBountyCooldown,
} from '../../db/queries.js';
import { markBountyCompleted } from './actions.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('bounty/death-listener');

// Vanilla formats (1.21-ish). Modded servers MAY differ - confirm with owner.
//   "<target> was slain by <killer>"
//   "<target> was slain by <killer> using [item]"
const PLAYER_KILL_RE      = /^([A-Za-z0-9_.]{1,32})\s+was\s+(?:slain|killed|murdered)\s+by\s+([A-Za-z0-9_.]{1,32})(?:\s+using\s+\[.+\])?\s*$/;

// Vanilla bow-shot:
//   "<target> was shot by <killer>"
//   "<target> was shot by <killer> using [Bow]"
const PROJECTILE_KILL_RE  = /^([A-Za-z0-9_.]{1,32})\s+was\s+shot\s+by\s+([A-Za-z0-9_.]{1,32})(?:\s+using\s+\[.+\])?\s*$/;

// Indirect causes - knockback, fall after attack, fire ticks. These exist
// in vanilla but are LOW signal in PvP (you'd punish "tricky kills"). Add
// if the owner wants:
//   "<target> was knocked into the void by <killer>"
//   "<target> was burned to death whilst fighting <killer>"
// const INDIRECT_RE = /...;

function matchKill(message) {
  let m = PLAYER_KILL_RE.exec(message);
  if (m) return { targetName: m[1], killerName: m[2] };
  m = PROJECTILE_KILL_RE.exec(message);
  if (m) return { targetName: m[1], killerName: m[2] };
  return null;
}

export function registerDeathListener(discordClient) {
  // Death messages are server-side tellraws (system position), not player
  // chat, so listen on the wrapper's `message` event which covers both.
  mc.on('message', ({ message, bot }) => {
    handleChat({ message, bot, discordClient }).catch((e) =>
      log.warn(`death-listener: ${e.message}`),
    );
  });
  log.info('death listener registered (using vanilla regex set - confirm with server)');
}

async function handleChat({ message, discordClient }) {
  const hit = matchKill(String(message ?? ''));
  if (!hit) return;
  if (hit.targetName === hit.killerName) return; // self-deaths are filtered above; defensive

  // Look up Discord users for both sides. Target must be linked (otherwise
  // there's no bounty on them). Killer can be unlinked - we'll mark the
  // bounty completed with a null claimer, and the link flow gates payout.
  const target = await getUserByMcName(hit.targetName);
  if (!target) return;

  const bounties = await getActiveBountiesByTarget(target.discord_id);
  if (!bounties.length) return;

  const killer = await getUserByMcName(hit.killerName);
  // Self-bounty edge: if poster is the killer, skip (no payout to self).
  for (const b of bounties) {
    if (killer && b.poster_discord_id === killer.discord_id) continue;
    try {
      await markBountyCompleted({
        bountyId: b.id,
        killerDiscordId: killer?.discord_id ?? null,
        discordClient,
      });
      await setBountyCooldown(target.discord_id);
      log.info(`bounty #${b.id} completed via kill: ${hit.killerName} -> ${hit.targetName}`);
    } catch (e) {
      log.warn(`mark complete #${b.id}: ${e.message}`);
    }
  }
}
