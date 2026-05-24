// Query helpers. Phase 1 only needs users + link_codes; later phases will extend
// this file rather than scattering supabase calls across the codebase.

import { supabase } from './client.js';

// ---------- users ----------

export async function getUserByDiscord(discordId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('discord_id', discordId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getUserByMcUuid(mcUuid) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('mc_uuid', mcUuid)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Upserts the user row, attaching MC identity. Used by the HTTP /verify endpoint.
// status is preserved if the caller passes it explicitly; otherwise we leave the
// existing column alone (only setting it on insert via DB default 'none'). The
// caller is responsible for picking a sensible status - see performLink().
export async function linkUser({ discordId, mcUuid, mcName, status }) {
  const row = { discord_id: discordId, mc_uuid: mcUuid, mc_name: mcName };
  if (status) row.status = status;

  const { data, error } = await supabase
    .from('users')
    .upsert(row, { onConflict: 'discord_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Low-level: wipe MC identity only. Kept around for callers that want a
// minimal unlink without cascading. The /unlink command uses cascadeUnlinkRow
// (below) plus the orchestrator in systems/linking/cascade-unlink.js instead.
export async function unlinkUser(discordId, { resetStatus = false } = {}) {
  const patch = { mc_uuid: null, mc_name: null };
  if (resetStatus) patch.status = 'none';

  const { error } = await supabase
    .from('users')
    .update(patch)
    .eq('discord_id', discordId);
  if (error) throw error;
}

// Full cascading DB clear used by /unlink. Wipes MC identity, sponsor link,
// resets status to 'none', and sets the re-link cooldown if given.
export async function cascadeUnlinkRow({ discordId, cooldownUntil }) {
  const { error } = await supabase
    .from('users')
    .update({
      mc_uuid: null,
      mc_name: null,
      status: 'none',
      sponsor_discord_id: null,
      sponsored_at: null,
      next_link_at: cooldownUntil ? cooldownUntil.toISOString() : null,
    })
    .eq('discord_id', discordId);
  if (error) throw error;
}

export async function clearUnlinkCooldown(discordId) {
  const { error } = await supabase
    .from('users')
    .update({ next_link_at: null })
    .eq('discord_id', discordId);
  if (error) throw error;
}

// Returns the rows of users currently sponsored by this Discord id. Used by
// /unlink to block trusted users with an outstanding sponsorship.
export async function getActiveSponseesOf(sponsorDiscordId) {
  const { data, error } = await supabase
    .from('users')
    .select('discord_id, mc_uuid, mc_name, status')
    .eq('sponsor_discord_id', sponsorDiscordId)
    .eq('status', 'sponsee');
  if (error) throw error;
  return data || [];
}

// Append-only audit log for sponsor lifecycle events (sponsored/removed/punished/
// auto_trusted/self_unlink). All fields are nullable - pass what's relevant.
export async function logSponsorAction({
  sponsorDiscordId = null,
  sponseeDiscordId = null,
  action,
  severity = null,
  strikeDelta = null,
  notes = null,
}) {
  const { error } = await supabase
    .from('sponsor_logs')
    .insert({
      sponsor_discord_id: sponsorDiscordId,
      sponsee_discord_id: sponseeDiscordId,
      action,
      severity,
      strike_delta: strikeDelta,
      notes,
    });
  if (error) throw error;
}

// ---------- link codes ----------

export async function createLinkCode({ code, discordId, expiresAt, interactionToken = null, applicationId = null }) {
  // Wipe any prior pending code for this user first so /link is idempotent.
  await supabase.from('link_codes').delete().eq('discord_id', discordId);

  const { error } = await supabase.from('link_codes').insert({
    code,
    discord_id: discordId,
    expires_at: expiresAt.toISOString(),
    interaction_token: interactionToken,
    application_id:    applicationId,
  });
  if (error) throw error;
}

export async function consumeLinkCode(code) {
  // Read-then-delete. Postgres-level race is fine here: the worst case is two
  // chat messages racing to claim the same code, and the delete is the gate.
  const { data, error } = await supabase
    .from('link_codes')
    .select('*')
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  if (new Date(data.expires_at).getTime() < Date.now()) {
    await supabase.from('link_codes').delete().eq('code', code);
    return null;
  }

  const { error: delErr } = await supabase.from('link_codes').delete().eq('code', code);
  if (delErr) throw delErr;
  return data;
}

export async function cleanupExpiredLinkCodes() {
  const { error } = await supabase
    .from('link_codes')
    .delete()
    .lt('expires_at', new Date().toISOString());
  if (error) throw error;
}

// ---------- admin lookups ----------

// Case-insensitive MC name match. Bedrock names have a leading '.'; callers
// can search with or without it.
export async function getUserByMcName(mcName) {
  const trimmed = String(mcName ?? '').trim();
  if (!trimmed) return null;
  const variants = trimmed.startsWith('.') ? [trimmed] : [trimmed, '.' + trimmed];
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .in('mc_name', variants)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// All currently-sponsored relationships, joined with sponsee info. Used by the
// Sponsorships subpanel "View Active" button.
export async function getActiveSponsorships() {
  const { data, error } = await supabase
    .from('users')
    .select('discord_id, mc_name, mc_uuid, sponsor_discord_id, sponsored_at, status')
    .eq('status', 'sponsee');
  if (error) throw error;
  return data || [];
}

// All linked-or-better users with a non-null mc_name. Used by the nickname
// sync to know which Discord members need their server nickname updated.
export async function getLinkedUsersWithMcName() {
  const { data, error } = await supabase
    .from('users')
    .select('discord_id, mc_name, status')
    .not('mc_name', 'is', null)
    .not('status', 'eq', 'none');
  if (error) throw error;
  return data || [];
}

export async function getPendingSponsorRequests() {
  const { data, error } = await supabase
    .from('sponsor_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getSettingsAudit({ key = null, limit = 25 } = {}) {
  let q = supabase
    .from('settings_audit')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (key) q = q.eq('key', key);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getSponsorLogs({ userId = null, limit = 25 } = {}) {
  let q = supabase
    .from('sponsor_logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(limit);
  if (userId) {
    // Match either side of the relationship.
    q = q.or(`sponsor_discord_id.eq.${userId},sponsee_discord_id.eq.${userId}`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function countUsersByStatus() {
  const { data, error } = await supabase
    .from('users')
    .select('status');
  if (error) throw error;
  const counts = { none: 0, linked: 0, sponsee: 0, trusted: 0, banned: 0 };
  for (const r of data ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

// ---------- admin writes ----------

// Generic field update. Caller supplies a whitelist-vetted patch (the admin
// command layer is responsible for not letting users edit arbitrary columns).
export async function updateUserFields(discordId, patch) {
  const { error } = await supabase
    .from('users')
    .update(patch)
    .eq('discord_id', discordId);
  if (error) throw error;
}

// Raw row nuke for /admin-user-force-unlink. Doesn't touch the MC server, Discord roles,
// or sponsor cleanup - that's the user-facing /unlink cascade's job. Use this
// only when the row is corrupt or social state is already cleaned up some
// other way.
export async function adminForceUnlinkRow(discordId) {
  const { error } = await supabase
    .from('users')
    .update({
      mc_uuid: null,
      mc_name: null,
      status: 'none',
      sponsor_discord_id: null,
      sponsored_at: null,
      next_link_at: null,
      next_sponsor_at: null,
    })
    .eq('discord_id', discordId);
  if (error) throw error;
}

// Upsert a user row keyed by discord_id, applying the given patch. Creates
// the row if missing - useful when admin actions touch users who've never run
// /link (e.g. force-sponsor against an MC name we've now discovered).
export async function upsertUser({ discordId, ...patch }) {
  const { data, error } = await supabase
    .from('users')
    .upsert({ discord_id: discordId, ...patch }, { onConflict: 'discord_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---------- sponsor_requests ----------

export async function createSponsorRequest({ requesterDiscordId, reason, applicantReferences, expiresAt }) {
  const { data, error } = await supabase
    .from('sponsor_requests')
    .insert({
      requester_discord_id: requesterDiscordId,
      reason,
      applicant_references: applicantReferences,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getSponsorRequest(id) {
  const { data, error } = await supabase
    .from('sponsor_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function setSponsorRequestMessageId(id, messageId) {
  const { error } = await supabase
    .from('sponsor_requests')
    .update({ message_id: messageId })
    .eq('id', id);
  if (error) throw error;
}

// Atomic "claim" transition. Returns the updated row, or null if the request
// was no longer pending (someone else got there first, or it expired).
export async function claimSponsorRequest(id, { newStatus, respondedBy = null, rejectionReason = null }) {
  const { data, error } = await supabase
    .from('sponsor_requests')
    .update({
      status: newStatus,
      responded_by_discord_id: respondedBy,
      responded_at: new Date().toISOString(),
      rejection_reason: rejectionReason,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getActivePendingRequestFor(discordId) {
  const { data, error } = await supabase
    .from('sponsor_requests')
    .select('*')
    .eq('requester_discord_id', discordId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Pending requests whose expires_at is in the past. Used by the background
// task; also reachable from the admin "Force Expire" trigger.
export async function getExpirableSponsorRequests() {
  const { data, error } = await supabase
    .from('sponsor_requests')
    .select('*')
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString());
  if (error) throw error;
  return data || [];
}

// ---------- background-task lookups ----------

// Sponsees whose sponsored_at is older than the configured promotion window.
// Caller still needs to check the sponsor's recent strike history before
// promoting (clean-window rule).
export async function getPromotableSponsees(autoPromoteDays) {
  const cutoff = new Date(Date.now() - autoPromoteDays * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('status', 'sponsee')
    .lt('sponsored_at', cutoff.toISOString());
  if (error) throw error;
  return data || [];
}

// Was a strike applied to this sponsor since `since`?
export async function sponsorHadStrikeSince(sponsorDiscordId, since) {
  const { data, error } = await supabase
    .from('sponsor_logs')
    .select('id')
    .eq('sponsor_discord_id', sponsorDiscordId)
    .in('action', ['punish', 'punish_sponsor_banned', 'punish_sponsor_suspended'])
    .gt('timestamp', since.toISOString())
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

export async function getUsersWithStrikes() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .gt('strikes', 0);
  if (error) throw error;
  return data || [];
}

// ---------- bounties ----------

export async function createBounty({ posterDiscordId, targetDiscordId, targetMcName, expiresAt }) {
  const { data, error } = await supabase
    .from('bounties')
    .insert({
      poster_discord_id: posterDiscordId,
      target_discord_id: targetDiscordId,
      target_mc_name:    targetMcName,
      status:            'depositing',
      expires_at:        expiresAt ? expiresAt.toISOString() : null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getBounty(id) {
  const { data, error } = await supabase
    .from('bounties')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getBountyItems(bountyId) {
  const { data, error } = await supabase
    .from('bounty_items')
    .select('*')
    .eq('bounty_id', bountyId);
  if (error) throw error;
  return data || [];
}

export async function addBountyItems(bountyId, items) {
  if (!items.length) return;
  const rows = items.map((it) => ({
    bounty_id: bountyId,
    item_id:   it.id,
    item_name: it.name,
    count:     it.count,
    nbt:       it.nbt ?? null,
  }));
  const { error } = await supabase.from('bounty_items').insert(rows);
  if (error) throw error;
}

export async function updateBountyFields(id, patch) {
  const { error } = await supabase.from('bounties').update(patch).eq('id', id);
  if (error) throw error;
}

// Atomic state transition. Returns updated row or null if expectedStatus
// didn't match (caller's claim is stale).
export async function transitionBounty(id, { expectedStatus, newStatus, patch = {} }) {
  const { data, error } = await supabase
    .from('bounties')
    .update({ status: newStatus, ...patch })
    .eq('id', id)
    .eq('status', expectedStatus)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getActiveBounties() {
  const { data, error } = await supabase
    .from('bounties')
    .select('*')
    .in('status', ['active'])
    .order('posted_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getActiveBountiesByTarget(targetDiscordId) {
  const { data, error } = await supabase
    .from('bounties')
    .select('*')
    .eq('target_discord_id', targetDiscordId)
    .eq('status', 'active');
  if (error) throw error;
  return data || [];
}

export async function getExpirableBounties() {
  const { data, error } = await supabase
    .from('bounties')
    .select('*')
    .eq('status', 'active')
    .lt('expires_at', new Date().toISOString());
  if (error) throw error;
  return data || [];
}

export async function getBountiesNeedingPayout() {
  const { data, error } = await supabase
    .from('bounties')
    .select('*')
    .eq('status', 'completed')
    .is('claimed_by_discord_id', null);
  if (error) throw error;
  return data || [];
}

// ---------- deposit sessions ----------

export async function createDepositSession({ userDiscordId, userMcName, pendingBountyId }) {
  // Wipe any prior in-flight session for this user.
  await supabase
    .from('deposit_sessions')
    .delete()
    .eq('user_discord_id', userDiscordId)
    .in('status', ['awaiting_tpa', 'awaiting_items']);

  const { data, error } = await supabase
    .from('deposit_sessions')
    .insert({
      user_discord_id:   userDiscordId,
      user_mc_name:      userMcName,
      pending_bounty_id: pendingBountyId,
      status:            'awaiting_tpa',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getActiveDepositForMcName(mcName) {
  const { data, error } = await supabase
    .from('deposit_sessions')
    .select('*')
    .eq('user_mc_name', mcName)
    .in('status', ['awaiting_tpa', 'awaiting_items'])
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getDepositSession(id) {
  const { data, error } = await supabase
    .from('deposit_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateDepositSession(id, patch) {
  const { error } = await supabase.from('deposit_sessions').update(patch).eq('id', id);
  if (error) throw error;
}

// ---------- bounty cooldowns ----------

export async function getBountyCooldown(targetDiscordId) {
  const { data, error } = await supabase
    .from('bounty_cooldowns')
    .select('*')
    .eq('target_discord_id', targetDiscordId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function setBountyCooldown(targetDiscordId) {
  const { error } = await supabase
    .from('bounty_cooldowns')
    .upsert({
      target_discord_id: targetDiscordId,
      last_bountied_at:  new Date().toISOString(),
    }, { onConflict: 'target_discord_id' });
  if (error) throw error;
}

// ---------- bounty blocklist ----------

export async function isBountyBlocked(discordId) {
  const { data, error } = await supabase
    .from('bounty_blocklist')
    .select('discord_id')
    .eq('discord_id', discordId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function addBountyBlock({ discordId, addedBy, reason }) {
  const { error } = await supabase
    .from('bounty_blocklist')
    .upsert({ discord_id: discordId, added_by: addedBy, reason }, { onConflict: 'discord_id' });
  if (error) throw error;
}

export async function removeBountyBlock(discordId) {
  const { error } = await supabase.from('bounty_blocklist').delete().eq('discord_id', discordId);
  if (error) throw error;
}

export async function listBountyBlocks() {
  const { data, error } = await supabase
    .from('bounty_blocklist')
    .select('*')
    .order('added_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---------- giveaways ----------

export async function createGiveaway({ channelId, hostDiscordId, prize, winnersCount, endsAt }) {
  const { data, error } = await supabase
    .from('giveaways')
    .insert({
      channel_id:      channelId,
      host_discord_id: hostDiscordId,
      prize,
      winners_count:   winnersCount,
      ends_at:         endsAt.toISOString(),
      status:          'active',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setGiveawayMessageId(id, messageId) {
  const { error } = await supabase.from('giveaways').update({ message_id: messageId }).eq('id', id);
  if (error) throw error;
}

export async function getGiveaway(id) {
  const { data, error } = await supabase
    .from('giveaways')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getExpirableGiveaways() {
  const { data, error } = await supabase
    .from('giveaways')
    .select('*')
    .eq('status', 'active')
    .lt('ends_at', new Date().toISOString());
  if (error) throw error;
  return data || [];
}

export async function addGiveawayEntry(giveawayId, discordId) {
  // Upsert is a no-op when already entered (composite primary key).
  const { error } = await supabase
    .from('giveaway_entries')
    .upsert({ giveaway_id: giveawayId, discord_id: discordId }, { onConflict: 'giveaway_id,discord_id' });
  if (error) throw error;
}

// ---------- IP security ----------

export async function addApprovedIp(discordId, ip) {
  // Postgres array_append, deduped via NOT in current array.
  const { error } = await supabase.rpc('users_add_approved_ip', { p_discord_id: discordId, p_ip: ip });
  if (error) {
    // Fallback path without the RPC if you haven't defined it: read-modify-write.
    const user = await getUserByDiscord(discordId);
    if (!user) throw new Error(`user not found: ${discordId}`);
    const set = new Set([...(user.approved_ips ?? []), ip]);
    const { error: updErr } = await supabase
      .from('users')
      .update({ approved_ips: [...set] })
      .eq('discord_id', discordId);
    if (updErr) throw updErr;
  }
}

export async function removeApprovedIp(discordId, ip) {
  const user = await getUserByDiscord(discordId);
  if (!user) return;
  const next = (user.approved_ips ?? []).filter((x) => x !== ip);
  const { error } = await supabase
    .from('users')
    .update({ approved_ips: next })
    .eq('discord_id', discordId);
  if (error) throw error;
}

export async function clearApprovedIps(discordId) {
  const { error } = await supabase
    .from('users')
    .update({ approved_ips: [], pending_ip: null, pending_ip_at: null })
    .eq('discord_id', discordId);
  if (error) throw error;
}

export async function setPendingIp(discordId, ip) {
  const { error } = await supabase
    .from('users')
    .update({ pending_ip: ip, pending_ip_at: new Date().toISOString() })
    .eq('discord_id', discordId);
  if (error) throw error;
}

export async function clearPendingIp(discordId) {
  const { error } = await supabase
    .from('users')
    .update({ pending_ip: null, pending_ip_at: null })
    .eq('discord_id', discordId);
  if (error) throw error;
}

export async function getGiveawayEntry(giveawayId, discordId) {
  const { data, error } = await supabase
    .from('giveaway_entries')
    .select('discord_id')
    .eq('giveaway_id', giveawayId)
    .eq('discord_id', discordId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listGiveawayEntries(giveawayId) {
  const { data, error } = await supabase
    .from('giveaway_entries')
    .select('discord_id')
    .eq('giveaway_id', giveawayId);
  if (error) throw error;
  return (data || []).map((r) => r.discord_id);
}

export async function endGiveaway(id, { winnerIds }) {
  const { data, error } = await supabase
    .from('giveaways')
    .update({
      status:     'ended',
      ended_at:   new Date().toISOString(),
      winner_ids: winnerIds,
    })
    .eq('id', id)
    .eq('status', 'active')
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function cancelGiveaway(id) {
  const { data, error } = await supabase
    .from('giveaways')
    .update({ status: 'cancelled', ended_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['active'])
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}
