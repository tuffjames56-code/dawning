// Sponsor state-change primitives. All three are designed so chunk 3's
// user-facing sponsor panel AND chunk 2's admin force-* commands share the
// same code path - they differ only in their callers' permission gates.
//
// Side effects (best-effort except DB):
//   - In-game bot: whitelist add/remove, LP group set, kick
//   - Discord: role add/remove
//   - DM: notifications (gated by send_link_dms)
//   - DB: users + sponsor_logs
//
// `actor` is the discord_id of the person triggering the action (or 'system'
// for background tasks); `source` is a short tag for the audit log
// ('panel' | 'admin' | 'auto').

import { mcWhitelistAdd, mcWhitelistRemove, mcSetLpGroup, mcClearLpGroup, mcKick } from '../../mineflayer/commands.js';
import { upsertUser, updateUserFields, logSponsorAction, getUserByDiscord } from '../../db/queries.js';
import { env } from '../../utils/config.js';
import { getSetting } from '../settings/index.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('sponsor/actions');

// ----- helpers -----

async function modifyRoles(discordClient, discordId, { add = [], remove = [] }, reason) {
  if (!discordId) return;
  const addClean    = add.filter(Boolean);
  const removeClean = remove.filter(Boolean);
  if (addClean.length === 0 && removeClean.length === 0) return;

  let guild, member;
  try {
    guild  = await discordClient.guilds.fetch(env.discord.guildId);
    member = await guild.members.fetch({ user: discordId, force: true });
  } catch (e) {
    log.warn(`modifyRoles: couldn't fetch ${discordId}: ${e.message}`);
    return;
  }

  const cached    = [...member.roles.cache.keys()];
  const addIds    = addClean.filter((id) => !member.roles.cache.has(id));
  const removeIds = removeClean.filter((id) =>  member.roles.cache.has(id));
  const skipAdd   = addClean.filter((id) =>  member.roles.cache.has(id));
  const skipRemove = removeClean.filter((id) => !member.roles.cache.has(id));

  if (skipRemove.length > 0) {
    log.warn(
      `modifyRoles: requested remove of ${skipRemove.join(',')} from ${discordId}, ` +
      `but member doesn't have those roles. Current roles: [${cached.join(',')}]. ` +
      `Check that the role IDs in .env match the actual Discord role IDs.`,
    );
  }

  if (addIds.length > 0) {
    try {
      await member.roles.add(addIds, reason);
      log.info(`added roles [${addIds.join(',')}] to ${discordId}`);
    } catch (e) {
      log.warn(
        `modifyRoles: roles.add(${addIds.join(',')}) for ${discordId} threw: ${e.message}. ` +
        `Likely causes: bot lacks "Manage Roles" permission, OR bot's highest role sits below the target role in the role list.`,
      );
    }
  }
  if (removeIds.length > 0) {
    try {
      await member.roles.remove(removeIds, reason);
      log.info(`removed roles [${removeIds.join(',')}] from ${discordId}`);
    } catch (e) {
      log.warn(
        `modifyRoles: roles.remove(${removeIds.join(',')}) for ${discordId} threw: ${e.message}. ` +
        `Likely causes: bot lacks "Manage Roles" permission, OR bot's highest role sits below the target role in the role list.`,
      );
    }
  }
  if (skipAdd.length > 0) log.info(`role add skipped (already present) for ${discordId}: [${skipAdd.join(',')}]`);
}

async function tryDM(discordClient, discordId, content) {
  if (!discordId || !getSetting('send_link_dms')) return;
  try {
    const u = await discordClient.users.fetch(discordId);
    await u.send(content);
  } catch (e) {
    log.warn(`DM to ${discordId} failed: ${e.message}`);
  }
}

// ----- primitives -----

/**
 * Sponsor a user. Caller is responsible for checking canSponsor (or
 * intentionally bypassing it for admin force).
 */
export async function applySponsorship({
  sponsorId,
  sponseeId,
  sponseeMcName,
  sponseeMcUuid = null,
  discordClient,
  actor,
  source = 'panel',
}) {
  if (!sponseeMcName) throw new Error('applySponsorship needs sponseeMcName');

  // Server-side: whitelist + LP group. Both best-effort.
  try { await mcWhitelistAdd(sponseeMcName); }
  catch (e) { log.warn(`whitelist add ${sponseeMcName}: ${e.message}`); }
  try { await mcSetLpGroup(sponseeMcName, env.luckperms.sponseeGroup); }
  catch (e) { log.warn(`setLpGroup ${sponseeMcName}: ${e.message}`); }

  // DB - upsert ensures the row exists even if sponsee never ran /link.
  await upsertUser({
    discordId: sponseeId,
    mc_name: sponseeMcName,
    mc_uuid: sponseeMcUuid,
    status: 'sponsee',
    sponsor_discord_id: sponsorId,
    sponsored_at: new Date().toISOString(),
  });

  // Discord role
  await modifyRoles(discordClient, sponseeId, { add: [env.discord.sponseeRoleId] }, `sponsored by ${sponsorId}`);

  // DMs
  const displayName = String(sponseeMcName).replace(/^\./, '');
  await tryDM(discordClient, sponsorId,
    `You're sponsoring \`${displayName}\`. Strikes apply to you if they're banned.`);
  await tryDM(discordClient, sponseeId,
    `You've been sponsored by <@${sponsorId}>. Join the main server!`);

  await logSponsorAction({
    sponsorDiscordId: sponsorId,
    sponseeDiscordId: sponseeId,
    action: source === 'admin' ? 'admin_force_sponsor' : 'sponsor',
    notes: `actor=${actor}, mc=${sponseeMcName}`,
  });

  log.info(`sponsor: ${sponsorId} -> ${sponseeId} (${sponseeMcName}) by ${actor} (${source})`);
}

/**
 * Remove a sponsorship. Sponsee drops back to 'linked'. Optionally applies
 * the configured cooldown to the (now-former) sponsor so they can't re-sponsor
 * immediately.
 */
export async function removeSponsorship({
  sponseeUser,
  discordClient,
  actor,
  applySponsorCooldown = true,
  source = 'panel',
}) {
  if (!sponseeUser || sponseeUser.status !== 'sponsee') {
    throw new Error('removeSponsorship: user is not a sponsee');
  }
  const sponsorId = sponseeUser.sponsor_discord_id;
  const mcName = sponseeUser.mc_name;

  if (mcName) {
    try { await mcWhitelistRemove(mcName); }
    catch (e) { log.warn(`whitelist remove ${mcName}: ${e.message}`); }
    try { await mcClearLpGroup(mcName); }
    catch (e) { log.warn(`clearLpGroup ${mcName}: ${e.message}`); }
    // Force-disconnect if they're online; vanilla whitelist only gates new
    // joins, so an active session would otherwise keep playing.
    try { await mcKick(mcName, 'Your sponsorship was removed.'); }
    catch (e) { log.warn(`kick ${mcName}: ${e.message}`); }
  }

  await updateUserFields(sponseeUser.discord_id, {
    status: 'linked',
    sponsor_discord_id: null,
    sponsored_at: null,
  });

  if (applySponsorCooldown && sponsorId) {
    const cooldown = new Date(Date.now() + getSetting('sponsor_remove_cooldown_hours') * 60 * 60 * 1000);
    await updateUserFields(sponsorId, { next_sponsor_at: cooldown.toISOString() });
  }

  await modifyRoles(discordClient, sponseeUser.discord_id, { remove: [env.discord.sponseeRoleId] }, `unsponsored by ${actor}`);

  const display = String(mcName ?? '').replace(/^\./, '');
  await tryDM(discordClient, sponseeUser.discord_id,
    `Your sponsorship has been removed. You've been taken off the main server whitelist.`);
  if (sponsorId) {
    await tryDM(discordClient, sponsorId,
      `Your sponsorship of \`${display}\` has been removed.`);
  }

  await logSponsorAction({
    sponsorDiscordId: sponsorId,
    sponseeDiscordId: sponseeUser.discord_id,
    action: source === 'admin' ? 'admin_force_unsponsor' : 'remove',
    notes: `actor=${actor}, mc=${mcName}`,
  });

  log.info(`unsponsor: ${sponsorId} -/-> ${sponseeUser.discord_id} (${mcName}) by ${actor} (${source})`);
}

/**
 * Promote a sponsee to trusted. Used by the daily auto-promote task AND
 * /admin-force-promote; the latter skips the 15-day eligibility check.
 */
export async function promoteToTrusted({ userId, discordClient, actor, source = 'auto' }) {
  const user = await getUserByDiscord(userId);
  if (!user) throw new Error(`promoteToTrusted: no user record for ${userId}`);
  const mcName = user.mc_name;

  if (mcName) {
    try { await mcSetLpGroup(mcName, env.luckperms.trustedGroup); }
    catch (e) { log.warn(`setLpGroup ${mcName}: ${e.message}`); }
  }

  await updateUserFields(userId, { status: 'trusted' });

  await modifyRoles(discordClient, userId, {
    add: [env.discord.trustedRoleId],
    remove: [env.discord.sponseeRoleId],
  }, `promoted to trusted by ${actor}`);

  await tryDM(discordClient, userId,
    `🎉 You've been promoted to Trusted! You can now sponsor others.`);

  await logSponsorAction({
    sponsorDiscordId: user.sponsor_discord_id ?? null,
    sponseeDiscordId: userId,
    action: source === 'admin' ? 'admin_force_promote' : 'auto_promote',
    notes: `actor=${actor}, prior_status=${user.status}, mc=${mcName}`,
  });

  log.info(`promote: ${userId} (${mcName}) by ${actor} (${source})`);
}
