// Admin "speak through the bot" command.
//
//   /say mc message:...                bot says it in MC public chat as itself
//   /say discord channel:#x message:.. bot posts the message in that channel
//
// Safety:
//   - MC mode REJECTS any message that begins with "/" — otherwise an admin
//     typo could turn into the bot executing a server command as OP.
//   - Message length capped at 240 chars (MC's hard ceiling is 256 incl. our
//     prefix; this gives margin). Discord side caps to 2000.
//   - Both modes require ADMIN_ROLE_ID; the slash command's default member
//     perm flag hides it from non-admins, and requireAdmin double-checks.

import { SlashCommandBuilder, ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { requireAdmin } from '../utils/admin-gate.js';
import { mc } from '../mineflayer/bot.js';

const MAX_MC_LEN      = 240;
const MAX_DISCORD_LEN = 2000;

export const data = new SlashCommandBuilder()
  .setName('say')
  .setDescription('Admin: speak through the bot.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) => s.setName('mc').setDescription('Say something in Minecraft chat as the bot.')
    .addStringOption((o) => o.setName('message').setDescription('What to say in-game').setRequired(true).setMaxLength(MAX_MC_LEN)))
  .addSubcommand((s) => s.setName('discord').setDescription('Post a message in a Discord channel as the bot.')
    .addChannelOption((o) => o.setName('channel').setDescription('Target channel').setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread))
    .addStringOption((o) => o.setName('message').setDescription('What to post').setRequired(true).setMaxLength(MAX_DISCORD_LEN)));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();

  if (sub === 'mc') {
    const raw = interaction.options.getString('message').trim();
    if (raw.length === 0) {
      await interaction.reply({ content: 'Message is empty.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (raw.startsWith('/')) {
      await interaction.reply({
        content: '`/say mc` won\'t send messages that start with `/` — that would execute a server command. Drop the slash or run it in-game directly.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!mc.bot) {
      await interaction.reply({ content: 'The in-game bot isn\'t connected right now.', flags: MessageFlags.Ephemeral });
      return;
    }
    try {
      mc.bot.chat(raw);
      await interaction.reply({ content: `✓ Said in MC: \`${raw.slice(0, 80)}\``, flags: MessageFlags.Ephemeral });
    } catch (e) {
      await interaction.reply({ content: `✗ ${e.message}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (sub === 'discord') {
    const channel = interaction.options.getChannel('channel');
    const raw     = interaction.options.getString('message');
    try {
      await channel.send({ content: raw, allowedMentions: { parse: ['users', 'roles', 'everyone'] } });
      await interaction.reply({ content: `✓ Posted to <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
    } catch (e) {
      await interaction.reply({
        content: `✗ Couldn't post: ${e.message} (check the bot has Send Messages in <#${channel.id}>).`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
