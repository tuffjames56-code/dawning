import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { buttonHandlers } from './registry.js';
import { generateLinkCode } from '../utils/code.js';
import { createLinkCode, getUserByDiscord } from '../db/queries.js';
import { env } from '../utils/config.js';
import { getSetting } from '../systems/settings/index.js';
import { buildVerifyInstructions, alreadyLinkedMessage } from '../utils/messages.js';
import { logger } from '../utils/logger.js';

const log = logger.child('panels/verify');

const CUSTOM_ID = 'verify:request_code';

export function buildVerifyPanel() {
  const requestChannel = env.discord.requestSponsorChannelId
    ? `<#${env.discord.requestSponsorChannelId}>`
    : '#request-sponsor';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔗 Link your Discord to Minecraft')
    .setDescription(
      `Click below to link your Discord to your Minecraft account.\n\n` +
      `After linking, you'll need a trusted member to sponsor you before you can ` +
      `join the main server. Request a sponsor in ${requestChannel}.`,
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_ID)
      .setLabel('Link Account')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row] };
}

buttonHandlers.set(CUSTOM_ID, async (interaction) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Hard gate. When maintenance is on, no new codes get issued.
    if (getSetting('maintenance_mode')) {
      await interaction.editReply('Linking is temporarily disabled (maintenance mode). Check back later.');
      return;
    }

    // Block already-linked users (any non-'none' status). /unlink resets
    // status='linked' back to 'none' so re-linking is still possible.
    const existing = await getUserByDiscord(interaction.user.id);
    if (existing && existing.status && existing.status !== 'none') {
      await interaction.editReply(alreadyLinkedMessage(existing.mc_name));
      return;
    }

    // Re-link cooldown set by /unlink. Only applies when status='none'.
    if (existing?.next_link_at) {
      const cooldown = new Date(existing.next_link_at);
      if (cooldown.getTime() > Date.now()) {
        const unix = Math.floor(cooldown.getTime() / 1000);
        await interaction.editReply(`You recently unlinked. You can re-link <t:${unix}:R>.`);
        return;
      }
    }

    const code = generateLinkCode();
    const expiresAt = new Date(Date.now() + getSetting('link_code_ttl_minutes') * 60 * 1000);
    // Save the interaction token + appId so the /verify HTTP endpoint can
    // edit this ephemeral later via Discord's webhook API (turns the
    // "your code is ..." message into "✓ Linked!" after a successful link).
    await createLinkCode({
      code,
      discordId: interaction.user.id,
      expiresAt,
      interactionToken: interaction.token,
      applicationId:    interaction.applicationId,
    });

    await interaction.editReply(buildVerifyInstructions(code));
  } catch (err) {
    log.error('verify panel handler failed:', err);
    await interaction.editReply('Something went wrong generating your code. Try again in a moment.');
  }
});
