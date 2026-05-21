// Grouped under one /info command with subcommands to keep the command list
// tidy. Slash command UX is the same as having /avatar /userinfo /serverinfo.

import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('info')
  .setDescription('Quick info lookups.')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('avatar').setDescription('Show a user\'s avatar.')
    .addUserOption((o) => o.setName('user').setDescription('User (defaults to you)').setRequired(false)))
  .addSubcommand((s) => s.setName('user').setDescription('Show info about a user.')
    .addUserOption((o) => o.setName('user').setDescription('User (defaults to you)').setRequired(false)))
  .addSubcommand((s) => s.setName('server').setDescription('Show info about this server.'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'avatar') {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const url  = user.displayAvatarURL({ size: 1024, extension: 'png' });
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`${user.tag}'s avatar`)
      .setImage(url);
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (sub === 'user') {
    const user = interaction.options.getUser('user') ?? interaction.user;
    let member;
    try { member = await interaction.guild.members.fetch({ user: user.id, force: true }); }
    catch { member = null; }

    const created   = `<t:${Math.floor(user.createdTimestamp / 1000)}:F> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)`;
    const joined    = member?.joinedTimestamp
      ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F> (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)`
      : '_(not in this server)_';
    const roles     = member
      ? member.roles.cache.filter((r) => r.id !== interaction.guild.id).map((r) => `<@&${r.id}>`).join(' ') || '_(none)_'
      : '_(not in this server)_';

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || 0x5865F2)
      .setTitle(member?.displayName ?? user.username)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Tag',       value: user.tag, inline: true },
        { name: 'ID',        value: user.id,  inline: true },
        { name: 'Bot',       value: user.bot ? 'yes' : 'no', inline: true },
        { name: 'Created',   value: created },
        { name: 'Joined',    value: joined },
        { name: 'Roles',     value: roles.slice(0, 1024) },
      );
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (sub === 'server') {
    const g = interaction.guild;
    let owner = '?';
    try { owner = `<@${(await g.fetchOwner()).id}>`; } catch { /* noop */ }

    const created = `<t:${Math.floor(g.createdTimestamp / 1000)}:F> (<t:${Math.floor(g.createdTimestamp / 1000)}:R>)`;
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(g.name)
      .setThumbnail(g.iconURL({ size: 256 }) ?? null)
      .addFields(
        { name: 'Owner',     value: owner, inline: true },
        { name: 'Members',   value: String(g.memberCount), inline: true },
        { name: 'Channels',  value: String(g.channels.cache.size), inline: true },
        { name: 'Roles',     value: String(g.roles.cache.size), inline: true },
        { name: 'Boosts',    value: `${g.premiumSubscriptionCount ?? 0} (tier ${g.premiumTier})`, inline: true },
        { name: 'Created',   value: created },
      );
    await interaction.reply({ embeds: [embed] });
  }
}
