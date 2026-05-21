// Two surfaces in one module:
//
//   1. Public panel posted in REQUEST_SPONSOR_CHANNEL_ID. Linked users click
//      "Request Sponsor" to open a modal (reason + references), which creates
//      a sponsor_requests row and posts a trusted-only embed in
//      SPONSOR_REQUESTS_CHANNEL_ID.
//
//   2. Per-request action buttons on that trusted-only embed:
//        req:sponsor:<id>   trusted member fulfils the request
//        req:reject:<id>    trusted member rejects (modal collects an
//                           optional reason); applies cooldown to requester
//
// customId map:
//   req:request-open                 -> public Request Sponsor button
//   req:request-submit               -> modal submit from above
//   req:sponsor:<id>                 -> trusted-only Sponsor This Person button
//   req:reject:<id>                  -> trusted-only Reject button -> opens modal
//   req:reject-submit:<id>           -> reject modal submit

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { buttonHandlers, modalHandlers } from './registry.js';
import {
  getUserByDiscord,
  getActivePendingRequestFor,
} from '../db/queries.js';
import {
  createRequest,
  sponsorFromRequest,
  rejectRequest,
} from '../systems/sponsor/request-actions.js';
import { canSponsor } from '../systems/sponsor/canSponsor.js';
import { requireTrusted } from '../utils/admin-gate.js';
import { getSetting } from '../systems/settings/index.js';
import { env } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const log = logger.child('panels/request-sponsor');

// ----- public panel -----

export function buildRequestSponsorPanel() {
  const expiryDays = getSetting('request_expiry_days');
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🙋 Request a Sponsor')
    .setDescription(
      `Linked but not yet on the main server? Open a request so a trusted ` +
      `member can vouch for you.\n\n` +
      `Click below and tell us why you'd be a good fit. A trusted member will ` +
      `respond, or your request will expire in ${expiryDays} days.\n\n` +
      `_You can only have one pending request at a time._`,
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('req:request-open')
      .setLabel('Request Sponsor')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row] };
}

// ----- requester side -----

buttonHandlers.set('req:request-open', async (interaction) => {
  // Pre-check before opening the modal so the user doesn't fill it in just to
  // be told no. Modal must open synchronously, so no defer.
  const block = await reasonRequesterCantApply(interaction.user.id);
  if (block) {
    await interaction.reply({ content: block, flags: MessageFlags.Ephemeral });
    return;
  }

  const minChars = getSetting('request_min_reason_chars');
  const maxChars = getSetting('request_max_reason_chars');

  const modal = new ModalBuilder()
    .setCustomId('req:request-submit')
    .setTitle('Request a Sponsor')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel(`Why should we sponsor you? (${minChars}-${maxChars} chars)`)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(minChars)
          .setMaxLength(maxChars),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('references')
          .setLabel('References (optional)')
          .setPlaceholder('Anyone here who can vouch for you?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500),
      ),
    );

  await interaction.showModal(modal);
});

modalHandlers.set('req:request-submit', async (interaction) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Re-check eligibility after the modal: state could have changed in the
  // seconds it took the user to type.
  const block = await reasonRequesterCantApply(interaction.user.id);
  if (block) {
    await interaction.editReply(block);
    return;
  }

  const requesterUser = await getUserByDiscord(interaction.user.id);
  const reason = interaction.fields.getTextInputValue('reason').trim();
  const references = (interaction.fields.getTextInputValue('references') || '').trim() || null;

  try {
    const request = await createRequest({
      requesterUser,
      reason,
      applicantReferences: references,
      discordClient: interaction.client,
    });
    await interaction.editReply(
      `✓ Your request was posted (#${request.id}). You'll be DM'd when a ` +
      `trusted member responds.`,
    );
  } catch (e) {
    log.error('request-submit failed:', e);
    await interaction.editReply(`✗ ${e.message}`);
  }
});

// Returns a reason string when the user can't apply, or null when they can.
async function reasonRequesterCantApply(discordId) {
  if (getSetting('maintenance_mode')) {
    return 'Sponsor requests are currently disabled (maintenance mode).';
  }
  if (!env.discord.sponsorRequestsChannelId) {
    return 'Sponsor requests aren\'t configured on this server yet. Ask an admin.';
  }

  const user = await getUserByDiscord(discordId);
  if (!user || user.status === 'none') {
    return 'Link your Discord to Minecraft first via the verify panel.';
  }
  if (user.status === 'banned') {
    return 'You can\'t request a sponsor.';
  }
  if (user.status !== 'linked') {
    return `You're already \`${user.status}\` — you don't need a sponsor request.`;
  }

  const existing = await getActivePendingRequestFor(discordId);
  if (existing) {
    return `You already have a pending request (#${existing.id}). Wait for a response or for it to expire.`;
  }

  if (user.last_request_ended_at) {
    const cooldownHours = getSetting('request_rejection_cooldown_hours');
    const ready = new Date(user.last_request_ended_at).getTime() + cooldownHours * 60 * 60 * 1000;
    if (ready > Date.now()) {
      const unix = Math.floor(ready / 1000);
      return `Your last request was declined or expired. You can submit a new one <t:${unix}:R>.`;
    }
  }

  return null;
}

// ----- trusted-side action buttons -----

buttonHandlers.set('req:sponsor', async (interaction, requestId) => {
  if (!(await requireTrusted(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Re-run the sponsor's own gate (capacity / cooldown / strikes).
  const c = await canSponsor(interaction.user.id);
  if (!c.allowed) {
    await interaction.editReply(c.reason);
    return;
  }

  const result = await sponsorFromRequest({
    requestId,
    sponsorId: interaction.user.id,
    discordClient: interaction.client,
    actor: interaction.user.id,
  });

  if (!result.ok) {
    const messages = {
      not_found:         'That request no longer exists.',
      already_resolved:  'That request was already resolved by someone else.',
      requester_missing: 'The requester\'s account record is gone.',
    };
    await interaction.editReply(messages[result.reason] ?? `Couldn't sponsor: ${result.reason}`);
    return;
  }

  await interaction.editReply(`✓ Request #${requestId} sponsored.`);
});

buttonHandlers.set('req:reject', async (interaction, requestId) => {
  if (!(await requireTrusted(interaction))) return;

  // Modal opens synchronously off the click; no defer.
  const modal = new ModalBuilder()
    .setCustomId(`req:reject-submit:${requestId}`)
    .setTitle('Reject Sponsor Request')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rejection_reason')
          .setLabel('Reason (optional - DM\'d to requester)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500),
      ),
    );
  await interaction.showModal(modal);
});

modalHandlers.set('req:reject-submit', async (interaction, requestId) => {
  if (!(await requireTrusted(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rejectionReason = (interaction.fields.getTextInputValue('rejection_reason') || '').trim() || null;

  const result = await rejectRequest({
    requestId,
    adminId: interaction.user.id,
    rejectionReason,
    discordClient: interaction.client,
  });

  if (!result.ok) {
    await interaction.editReply(
      result.reason === 'already_resolved'
        ? 'That request was already resolved.'
        : `Couldn't reject: ${result.reason}`,
    );
    return;
  }

  await interaction.editReply(`✓ Request #${requestId} rejected.`);
});
