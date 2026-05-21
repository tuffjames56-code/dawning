import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { generateLinkCode } from '../utils/code.js';
import { createLinkCode, getUserByDiscord } from '../db/queries.js';
import { getSetting } from '../systems/settings/index.js';
import { buildVerifyInstructions, alreadyLinkedMessage } from '../utils/messages.js';
import { logger } from '../utils/logger.js';

const log = logger.child('cmd/link');

export const data = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link your Discord to your Minecraft account.')
  .setDMPermission(true);

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Hard gate. When maintenance is on, nothing new gets issued.
  if (getSetting('maintenance_mode')) {
    await interaction.editReply('Linking is temporarily disabled (maintenance mode). Check back later.');
    return;
  }

  // Status-gated: any non-'none' status (linked/sponsee/trusted/banned) blocks.
  // /unlink resets status='linked' back to 'none', so re-linking still works.
  const existing = await getUserByDiscord(interaction.user.id);
  if (existing && existing.status && existing.status !== 'none') {
    await interaction.editReply(alreadyLinkedMessage(existing.mc_name));
    return;
  }

  // Re-link cooldown set by /unlink. Only applies when status is 'none'
  // (which the previous gate confirms).
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
  await createLinkCode({ code, discordId: interaction.user.id, expiresAt });

  const body = `🔗 **Account linking**\n\n${buildVerifyInstructions(code)}`;

  try {
    await interaction.user.send(body);
    await interaction.editReply(`📬 Sent you a DM with your link code. Check your DMs!`);
  } catch (e) {
    log.warn(`DM failed for ${interaction.user.id}: ${e.message}`);
    // Fallback: show the same instructions ephemerally so the user isn't stuck.
    await interaction.editReply(
      `I couldn't DM you (DMs may be closed). Here are the same instructions:\n\n` +
      buildVerifyInstructions(code),
    );
  }
}
