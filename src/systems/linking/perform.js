// Shared link operation. Phase 2 uses this from the HTTP /verify endpoint;
// any future codepath (e.g. an admin "force-link" command) can reuse it.

import { consumeLinkCode, linkUser, getUserByMcUuid, getUserByDiscord } from '../../db/queries.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('linking');

/**
 * Performs a Discord <-> MC link given a code and verified MC identity.
 * Caller is responsible for having proven the MC identity (e.g. HTTP secret).
 *
 * Returns { success, message, discordId?, mcName? }.
 */
export async function performLink({ mcUuid, mcName, code }) {
  const codeRow = await consumeLinkCode(code);
  if (!codeRow) {
    return { success: false, message: 'Invalid or expired code. Generate a new one in Discord.' };
  }

  const existingByMc = await getUserByMcUuid(mcUuid);
  if (existingByMc && existingByMc.discord_id !== codeRow.discord_id) {
    return {
      success: false,
      message: 'This Minecraft account is already linked to a different Discord user.',
    };
  }

  // Don't downgrade users who are already sponsee/trusted/banned. Only set
  // status='linked' for fresh rows or rows still on the default 'none'.
  const existingByDiscord = await getUserByDiscord(codeRow.discord_id);
  const keepStatus = existingByDiscord && existingByDiscord.status && existingByDiscord.status !== 'none';
  const status = keepStatus ? existingByDiscord.status : 'linked';

  await linkUser({ discordId: codeRow.discord_id, mcUuid, mcName, status });
  log.info(`linked discord=${codeRow.discord_id} mc=${mcName} (${mcUuid}) status=${status}`);

  return {
    success:          true,
    message:          'Linked!',
    discordId:        codeRow.discord_id,
    mcName,
    // Pass the ephemeral's interaction handle back so the caller can edit
    // the original "your code is ..." message into a success state.
    interactionToken: codeRow.interaction_token ?? null,
    applicationId:    codeRow.application_id    ?? null,
  };
}
