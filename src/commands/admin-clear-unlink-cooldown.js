import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { env } from '../utils/config.js';
import { clearUnlinkCooldown, getUserByDiscord } from '../db/queries.js';
import { logger } from '../utils/logger.js';

const log = logger.child('cmd/admin-clear-unlink-cooldown');

// Discord perm flag is a UI hint - the actual gate is the role check below.
export const data = new SlashCommandBuilder()
  .setName('admin-clear-unlink-cooldown')
  .setDescription("Admin: clear a user's re-link cooldown.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) =>
    o.setName('user').setDescription('User whose cooldown to clear').setRequired(true),
  );

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (env.discord.adminRoleId && !interaction.member?.roles?.cache?.has(env.discord.adminRoleId)) {
    await interaction.editReply('Admin role required.');
    return;
  }

  const target = interaction.options.getUser('user');
  const row = await getUserByDiscord(target.id);
  if (!row) {
    await interaction.editReply(`<@${target.id}> has no user record.`);
    return;
  }
  if (!row.next_link_at) {
    await interaction.editReply(`<@${target.id}> has no active re-link cooldown.`);
    return;
  }

  await clearUnlinkCooldown(target.id);
  log.info(`admin=${interaction.user.id} cleared unlink cooldown for ${target.id}`);
  await interaction.editReply(`✓ Cleared re-link cooldown for <@${target.id}>.`);
}
