// Orchestrates the full self-unlink cascade. Side effects beyond the DB
// (server-side commands, Discord role removal, sponsor DM) are best-effort
// and logged on failure; the DB write is the source of truth and must succeed.
//
// Order of operations is chosen so failures degrade gracefully:
//   1. DM sponsor (informational, can fail without consequence)
//   2. In-game whitelist remove + LP clear + kick (idempotent server-side ops)
//   3. Discord role removal (independent per role)
//   4. DB cascade write (single transaction; bails out if it fails)
//   5. sponsor_logs entry (audit only; informational)

import { mcWhitelistRemove, mcClearLpGroup, mcKick } from '../../mineflayer/commands.js';
import { cascadeUnlinkRow, logSponsorAction } from '../../db/queries.js';
import { env } from '../../utils/config.js';
import { getSetting } from '../settings/index.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('linking/cascade');

/**
 * Performs the full self-unlink cascade for a user.
 *
 * @param {object}        opts
 * @param {object}        opts.user           full users-row before mutation
 * @param {import('discord.js').Client} opts.discordClient
 * @returns {Promise<{cooldownUntil: Date}>}
 */
export async function cascadeUnlink({ user, discordClient }) {
  const cooldownUntil = new Date(Date.now() + getSetting('unlink_cooldown_hours') * 60 * 60 * 1000);

  // 1. Notify the sponsor if this was a sponsee (gated by send_link_dms).
  if (user.status === 'sponsee' && user.sponsor_discord_id && getSetting('send_link_dms')) {
    try {
      const sponsor = await discordClient.users.fetch(user.sponsor_discord_id);
      const displayName = String(user.mc_name ?? '').replace(/^\./, '');
      await sponsor.send(
        `Your sponsee \`${displayName}\` has unlinked their account and is no longer on the main server.`,
      );
    } catch (e) {
      log.warn(`sponsor DM failed for ${user.sponsor_discord_id}: ${e.message}`);
    }
  }

  // 2. Server-side cleanup via the in-game bot.
  if (user.mc_name) {
    try { await mcWhitelistRemove(user.mc_name); }
    catch (e) { log.warn(`whitelist remove failed for ${user.mc_name}: ${e.message}`); }

    try { await mcClearLpGroup(user.mc_name); }
    catch (e) { log.warn(`luckperms clear failed for ${user.mc_name}: ${e.message}`); }

    try { await mcKick(user.mc_name, 'You unlinked your Discord.'); }
    catch (e) { log.warn(`kick failed for ${user.mc_name}: ${e.message}`); }
  }

  // 3. Discord role removal. Only remove roles the member actually has so
  // we don't waste API calls or trip role-hierarchy errors on missing ones.
  try {
    const guild = await discordClient.guilds.fetch(env.discord.guildId);
    const member = await guild.members.fetch(user.discord_id);
    const candidates = [
      env.discord.verifiedRoleId,
      env.discord.trustedRoleId,
      env.discord.sponseeRoleId,
    ].filter(Boolean);
    const toRemove = candidates.filter((id) => member.roles.cache.has(id));
    if (toRemove.length > 0) {
      await member.roles.remove(toRemove, 'self-unlink cascade');
    }
  } catch (e) {
    log.warn(`role cleanup failed for ${user.discord_id}: ${e.message}`);
  }

  // 4. DB write - the source of truth. If this throws, the caller sees a
  // partial unlink (Discord roles removed, server-side state wiped, but DB still says linked).
  // Better than silent inconsistency, but admin will need to follow up.
  await cascadeUnlinkRow({ discordId: user.discord_id, cooldownUntil });

  // 5. Audit log for sponsee/trusted exits. Informational only.
  if (user.status === 'sponsee' || user.status === 'trusted') {
    try {
      await logSponsorAction({
        sponsorDiscordId: user.sponsor_discord_id ?? null,
        sponseeDiscordId: user.discord_id,
        action: 'self_unlink',
        notes: `prior_status=${user.status}, mc=${user.mc_name}`,
      });
    } catch (e) {
      log.warn(`sponsor_logs insert failed: ${e.message}`);
    }
  }

  log.info(`cascade-unlink done: discord=${user.discord_id} prior_status=${user.status} mc=${user.mc_name}`);
  return { cooldownUntil };
}
