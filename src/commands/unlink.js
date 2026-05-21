import {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { getUserByDiscord, getActiveSponseesOf } from '../db/queries.js';
import { getSetting } from '../systems/settings/index.js';

// /unlink is intentionally callable by ANY user - it always operates on
// interaction.user.id, never accepts a target argument. Don't add
// setDefaultMemberPermissions; that'd hide the command from non-admins.
export const data = new SlashCommandBuilder()
  .setName('unlink')
  .setDescription('Remove the link between your Discord and your Minecraft account.')
  .setDMPermission(true);

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!getSetting('allow_self_unlink')) {
    await interaction.editReply('Self-unlink is disabled. Contact an admin to unlink your account.');
    return;
  }

  const user = await getUserByDiscord(interaction.user.id);

  // Status gates. None of these reach the confirmation step.
  if (!user || !user.status || user.status === 'none') {
    await interaction.editReply(`Your account isn't linked.`);
    return;
  }
  if (user.status === 'banned') {
    await interaction.editReply(`Banned users can't unlink. Contact an admin.`);
    return;
  }
  if (user.status === 'trusted') {
    const sponsees = await getActiveSponseesOf(interaction.user.id);
    if (sponsees.length > 0) {
      const names = sponsees
        .map((s) => `\`${String(s.mc_name ?? '').replace(/^\./, '')}\``)
        .join(', ');
      await interaction.editReply(
        `You have an active sponsee (${names}). Remove your sponsorship via the sponsor panel before unlinking.`,
      );
      return;
    }
  }

  // Confirmation step. Buttons in an ephemeral message can only be clicked
  // by the user who received it, so static customIds are safe here.
  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('Unlink your account?')
    .setDescription(
      `This will:\n` +
      `• Remove your Minecraft account link\n` +
      `• Remove your Verified Discord role\n` +
      `• Remove you from the main server whitelist\n` +
      `• Remove any sponsor/sponsee/trusted roles\n` +
      `• Set a 24h cooldown before you can re-link\n\n` +
      `Proceed?`,
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('unlink:confirm')
      .setLabel('Yes, unlink')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('unlink:cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}
