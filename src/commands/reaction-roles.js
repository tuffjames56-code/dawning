// Posts a self-assign role embed with up to 5 toggle buttons. Modern Discord
// pattern (used to be called "reaction roles"; the button variant is cleaner
// and supports custom labels per role).
//
// No DB needed — the customId encodes the role id directly:
//   rrole:<roleId>
// Button handler grants the role if missing, removes it if present.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ChannelType,
  SlashCommandBuilder,
} from 'discord.js';
import { buttonHandlers } from '../panels/registry.js';
import { requireAdmin } from '../utils/admin-gate.js';
import { logger } from '../utils/logger.js';

const log = logger.child('reaction-roles');

export const data = new SlashCommandBuilder()
  .setName('reaction-roles')
  .setDescription('Admin: post a self-assign role panel with toggle buttons.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) => o.setName('title').setDescription('Embed title').setRequired(true).setMaxLength(200))
  .addStringOption((o) => o.setName('description').setDescription('Embed body').setRequired(true).setMaxLength(1500))
  .addRoleOption((o)   => o.setName('role1').setDescription('Role 1').setRequired(true))
  .addStringOption((o) => o.setName('label1').setDescription('Button label for role 1').setRequired(true).setMaxLength(40))
  .addRoleOption((o)   => o.setName('role2').setDescription('Role 2'))
  .addStringOption((o) => o.setName('label2').setDescription('Button label for role 2').setMaxLength(40))
  .addRoleOption((o)   => o.setName('role3').setDescription('Role 3'))
  .addStringOption((o) => o.setName('label3').setDescription('Button label for role 3').setMaxLength(40))
  .addRoleOption((o)   => o.setName('role4').setDescription('Role 4'))
  .addStringOption((o) => o.setName('label4').setDescription('Button label for role 4').setMaxLength(40))
  .addRoleOption((o)   => o.setName('role5').setDescription('Role 5'))
  .addStringOption((o) => o.setName('label5').setDescription('Button label for role 5').setMaxLength(40))
  .addChannelOption((o) => o.setName('channel').setDescription('Where to post (defaults to here)')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;

  const pairs = [];
  for (let i = 1; i <= 5; i++) {
    const role  = interaction.options.getRole(`role${i}`);
    const label = interaction.options.getString(`label${i}`);
    if (role && label) pairs.push({ role, label });
  }
  if (pairs.length === 0) {
    await interaction.reply({ content: 'Provide at least one role + label pair.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Sanity: bot must be able to manage every chosen role.
  const me = await interaction.guild.members.fetchMe();
  const cantManage = pairs.filter((p) => !p.role.editable);
  if (cantManage.length > 0) {
    await interaction.reply({
      content:
        `I can't manage these role(s): ${cantManage.map((p) => `<@&${p.role.id}>`).join(', ')}.\n` +
        `Move my role (${me.roles.highest.name}) above them in Server Settings → Roles.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const title   = interaction.options.getString('title');
  const description = interaction.options.getString('description');

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(title)
    .setDescription(description);

  const row = new ActionRowBuilder().addComponents(
    pairs.map((p) =>
      new ButtonBuilder()
        .setCustomId(`rrole:${p.role.id}`)
        .setLabel(p.label)
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  try {
    await channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: `✓ Posted in <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
  } catch (e) {
    await interaction.reply({ content: `✗ ${e.message}`, flags: MessageFlags.Ephemeral });
  }
}

// Toggle handler — works for ANY rrole:<roleId> button.
buttonHandlers.set('rrole', async (interaction, roleId) => {
  if (!interaction.guild || !interaction.member) return;
  const guild = interaction.guild;

  let role;
  try { role = await guild.roles.fetch(roleId); }
  catch (e) { log.warn(`rrole fetch ${roleId}: ${e.message}`); }
  if (!role) {
    await interaction.reply({ content: 'That role no longer exists.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!role.editable) {
    await interaction.reply({
      content: 'I can\'t manage that role (it sits above my own in the role list).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await guild.members.fetch({ user: interaction.user.id, force: true });
  const has = member.roles.cache.has(roleId);
  try {
    if (has) {
      await member.roles.remove(roleId, 'reaction role: toggle off');
      await interaction.reply({ content: `✓ Removed <@&${roleId}>.`, flags: MessageFlags.Ephemeral });
    } else {
      await member.roles.add(roleId, 'reaction role: toggle on');
      await interaction.reply({ content: `✓ Added <@&${roleId}>.`, flags: MessageFlags.Ephemeral });
    }
  } catch (e) {
    await interaction.reply({ content: `✗ ${e.message}`, flags: MessageFlags.Ephemeral });
  }
});
