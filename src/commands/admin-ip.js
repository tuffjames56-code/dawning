import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { requireAdmin } from '../utils/admin-gate.js';
import {
  getUserByDiscord,
  removeApprovedIp,
  clearApprovedIps,
  addApprovedIp,
} from '../db/queries.js';

export const data = new SlashCommandBuilder()
  .setName('admin-ip')
  .setDescription('Admin: manage a user\'s approved-IP list.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) => s.setName('list').setDescription('Show a user\'s approved + pending IPs.')
    .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove a single approved IP.')
    .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption((o) => o.setName('ip').setDescription('IP to remove').setRequired(true)))
  .addSubcommand((s) => s.setName('add').setDescription('Manually approve an IP for a user.')
    .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption((o) => o.setName('ip').setDescription('IP to approve').setRequired(true)))
  .addSubcommand((s) => s.setName('clear').setDescription('Wipe all approved + pending IPs (next join captures fresh).')
    .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const target = interaction.options.getUser('user');

  if (sub === 'list') {
    const u = await getUserByDiscord(target.id);
    if (!u) {
      await interaction.reply({ content: 'No user record found.', flags: MessageFlags.Ephemeral });
      return;
    }
    const approved = u.approved_ips ?? [];
    const pending = u.pending_ip;
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`IP record for ${u.mc_name ?? target.tag}`)
      .addFields(
        { name: `Approved (${approved.length})`, value: approved.length ? approved.map((ip) => `\`${ip}\``).join('\n') : '_(none)_' },
        { name: 'Pending', value: pending ? `\`${pending}\`` : '_(none)_' },
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === 'remove') {
    const ip = interaction.options.getString('ip');
    await removeApprovedIp(target.id, ip);
    await interaction.reply({ content: `✓ Removed \`${ip}\` from <@${target.id}>'s approved list.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === 'add') {
    const ip = interaction.options.getString('ip');
    await addApprovedIp(target.id, ip);
    await interaction.reply({ content: `✓ Approved \`${ip}\` for <@${target.id}>.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === 'clear') {
    await clearApprovedIps(target.id);
    await interaction.reply({ content: `✓ Wiped <@${target.id}>'s approved + pending IPs. Their next login captures fresh.`, flags: MessageFlags.Ephemeral });
  }
}
