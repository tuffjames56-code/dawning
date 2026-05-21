import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { buildVerifyPanel } from '../panels/verify.js';

export const data = new SlashCommandBuilder()
  .setName('verify-setup')
  .setDescription('Post the persistent verify panel in this channel.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.channel.send(buildVerifyPanel());
  await interaction.reply({
    content: '✓ Verify panel posted.',
    flags: MessageFlags.Ephemeral,
  });
}
