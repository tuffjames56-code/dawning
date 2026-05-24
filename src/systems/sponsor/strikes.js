// Strike punishment flow. Called by /admin-sponsor-punish.
//
// What it does:
//   1. Bans the sponsee (status='banned', whitelist remove, LP clear, role removal).
//   2. If they had a sponsor, applies strike_minor or strike_major strikes.
//      a. Crossing strike_threshold_ban    -> sponsor banned (full cleanup + DM).
//      b. Crossing strike_threshold_suspend -> sponsor's next_sponsor_at set ahead by strike_suspend_days (+DM).
//      c. Otherwise just a strike-count update + informational DM.
//   3. sponsor_logs entries for both sides (or 'punish_no_sponsor' if unsponsored).

import { mcWhitelistRemove, mcClearLpGroup, mcKick } from '../../mineflayer/commands.js';
import { updateUserFields, logSponsorAction, getUserByDiscord } from '../../db/queries.js';
import { env } from '../../utils/config.js';
import { getSetting } from '../settings/index.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('sponsor/strikes');

async function tryDM(discordClient, discordId, content) {
  if (!discordId || !getSetting('send_link_dms')) return;
  try {
    const u = await discordClient.users.fetch(discordId);
    await u.send(content);
  } catch (e) { log.warn(`DM ${discordId}: ${e.message}`); }
}

async function modifyRoles(discordClient, discordId, { add = [], remove = [] }, reason) {
  if (!discordId) return;
  try {
    const guild = await discordClient.guilds.fetch(env.discord.guildId);
    const member = await guild.members.fetch(discordId);
    const addIds = add.filter(Boolean).filter((id) => !member.roles.cache.has(id));
    const removeIds = remove.filter(Boolean).filter((id) => member.roles.cache.has(id));
    if (addIds.length > 0)    await member.roles.add(addIds, reason);
    if (removeIds.length > 0) await member.roles.remove(removeIds, reason);
  } catch (e) { log.warn(`roles ${discordId}: ${e.message}`); }
}

async function rconBan(mcName) {
  if (!mcName) return;
  try { await mcWhitelistRemove(mcName); }
  catch (e) { log.warn(`whitelist remove ${mcName}: ${e.message}`); }
  try { await mcClearLpGroup(mcName); }
  catch (e) { log.warn(`clearLpGroup ${mcName}: ${e.message}`); }
  try { await mcKick(mcName, 'You have been banned.'); }
  catch (e) { log.warn(`kick ${mcName}: ${e.message}`); }
}

export async function applyStrikePunishment({ sponseeUser, severity, discordClient, actor }) {
  if (!['minor', 'major'].includes(severity)) {
    throw new Error(`severity must be 'minor' or 'major', got: ${severity}`);
  }
  const delta = severity === 'major' ? getSetting('strike_major') : getSetting('strike_minor');

  // ----- Step 1: ban the sponsee.
  await rconBan(sponseeUser.mc_name);
  await updateUserFields(sponseeUser.discord_id, { status: 'banned' });
  await modifyRoles(discordClient, sponseeUser.discord_id, {
    remove: [env.discord.sponseeRoleId, env.discord.trustedRoleId, env.discord.verifiedRoleId],
  }, `punished: ${severity}`);
  await tryDM(discordClient, sponseeUser.discord_id,
    `You've been banned from the server (${severity} offense).`);

  // ----- Step 2: cascade strikes to the sponsor.
  const sponsorId = sponseeUser.sponsor_discord_id;
  if (!sponsorId) {
    await logSponsorAction({
      sponseeDiscordId: sponseeUser.discord_id,
      action: 'punish_no_sponsor',
      severity,
      strikeDelta: 0,
      notes: `actor=${actor}, mc=${sponseeUser.mc_name}`,
    });
    log.info(`strike: ${sponseeUser.discord_id} (${severity}, no sponsor) by ${actor}`);
    return { delta: 0, sponsorOutcome: 'no_sponsor' };
  }

  const sponsor = await getUserByDiscord(sponsorId);
  if (!sponsor) {
    // Edge case: sponsor row missing. Log and bail.
    await logSponsorAction({
      sponsorDiscordId: sponsorId,
      sponseeDiscordId: sponseeUser.discord_id,
      action: 'punish_sponsor_missing',
      severity,
      strikeDelta: 0,
      notes: `actor=${actor}, sponsor_id=${sponsorId}`,
    });
    return { delta: 0, sponsorOutcome: 'sponsor_missing' };
  }

  const newStrikes = (sponsor.strikes ?? 0) + delta;
  const banThreshold     = getSetting('strike_threshold_ban');
  const suspendThreshold = getSetting('strike_threshold_suspend');
  const updates = { strikes: newStrikes };
  let outcome = 'strike';
  const sponseeDisplay = String(sponseeUser.mc_name ?? '').replace(/^\./, '');

  const decayDays = getSetting('strike_decay_days');

  if (newStrikes >= banThreshold) {
    // ----- Sponsor banned themselves into oblivion.
    updates.status = 'banned';
    updates.next_sponsor_at = null;
    await rconBan(sponsor.mc_name);
    await modifyRoles(discordClient, sponsor.discord_id, {
      remove: [env.discord.trustedRoleId, env.discord.sponseeRoleId, env.discord.verifiedRoleId],
    }, `sponsor banned: ${newStrikes} strikes`);
    await tryDM(discordClient, sponsor.discord_id,
      `⛔ **Your sponsee was banned, and you've hit the strike limit.**\n\n` +
      `**Sponsee:** \`${sponseeDisplay}\`\n` +
      `**Severity:** ${severity}\n` +
      `**Your strikes:** ${newStrikes}/${banThreshold}\n\n` +
      `**What this means for you:**\n` +
      `• You've been removed from the main server (whitelist + roles).\n` +
      `• Your account is marked **banned**. You can no longer sponsor or play.\n` +
      `• Contact an admin if you believe this is in error.`,
    );
    outcome = 'sponsor_banned';
  } else if (newStrikes >= suspendThreshold) {
    // ----- Sponsor suspended from sponsoring.
    const suspendUntil = new Date(Date.now() + getSetting('strike_suspend_days') * 24 * 60 * 60 * 1000);
    updates.next_sponsor_at = suspendUntil.toISOString();
    const unix = Math.floor(suspendUntil.getTime() / 1000);
    await tryDM(discordClient, sponsor.discord_id,
      `⚠ **Your sponsee was banned. You've been suspended from sponsoring.**\n\n` +
      `**Sponsee:** \`${sponseeDisplay}\`\n` +
      `**Severity:** ${severity}\n` +
      `**Your strikes:** ${newStrikes}/${banThreshold}\n\n` +
      `**What this means for you:**\n` +
      `• You can no longer sponsor anyone new until <t:${unix}:R>.\n` +
      `• You can still play on the main server normally.\n` +
      `• One strike is removed automatically every **${decayDays} days clean** (no further punishments).\n` +
      `• At **${banThreshold} strikes**, your account is banned outright. Be careful who you vouch for.`,
    );
    outcome = 'sponsor_suspended';
  } else {
    // ----- Just an informational strike.
    await tryDM(discordClient, sponsor.discord_id,
      `⚠ **Your sponsee has been banned.**\n\n` +
      `**Sponsee:** \`${sponseeDisplay}\`\n` +
      `**Severity:** ${severity}\n` +
      `**Your strikes:** +${delta} → **${newStrikes}/${banThreshold}**\n\n` +
      `**What this means for you:**\n` +
      `• You picked up a strike for vouching for them.\n` +
      `• At **${suspendThreshold} strikes**, sponsoring gets suspended for ${getSetting('strike_suspend_days')} days.\n` +
      `• At **${banThreshold} strikes**, your own account is banned.\n` +
      `• One strike decays every **${decayDays} days clean** (no further punishments).\n` +
      `• Be more careful about who you vouch for next time.`,
    );
  }

  await updateUserFields(sponsor.discord_id, updates);

  await logSponsorAction({
    sponsorDiscordId: sponsor.discord_id,
    sponseeDiscordId: sponseeUser.discord_id,
    action: outcome === 'sponsor_banned'    ? 'punish_sponsor_banned'
          : outcome === 'sponsor_suspended' ? 'punish_sponsor_suspended'
          : 'punish',
    severity,
    strikeDelta: delta,
    notes: `actor=${actor}, sponsor_strikes_after=${newStrikes}, mc=${sponseeUser.mc_name}`,
  });

  log.info(`strike: ${sponseeUser.discord_id} (${severity}, +${delta}) sponsor=${sponsor.discord_id} -> ${newStrikes} (${outcome})`);
  return { delta, sponsorOutcome: outcome, sponsorStrikesAfter: newStrikes };
}
