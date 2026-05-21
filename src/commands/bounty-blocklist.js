import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { requireAdmin } from '../utils/admin-gate.js';
import {
  addBountyBlock,
  removeBountyBlock,
  listBountyBlocks,
  getUserByDiscord,
} from '../db/queries.js';

export const data = new SlashCommandBuilder()
  .setName('bounty-blocklist')
  .setDescription('Admin: manage the bounty blocklist (targets who can\'t be bountied).')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) => s.setName('add').setDescription('Block a user from being bountied.')
    .addUserOption((o) => o.setName('user').setDescription('Discord user').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(false)))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove a user from the blocklist.')
    .addUserOption((o) => o.setName('user').setDescription('Discord user').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('Show the current blocklist.'));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') ?? null;
    await addBountyBlock({ discordId: target.id, addedBy: interaction.user.id, reason });
    await interaction.reply({ content: `✓ <@${target.id}> added to bounty blocklist.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === 'remove') {
    const target = interaction.options.getUser('user');
    await removeBountyBlock(target.id);
    await interaction.reply({ content: `✓ <@${target.id}> removed from bounty blocklist.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === 'list') {
    const rows = await listBountyBlocks();
    if (!rows.length) {
      await interaction.reply({ content: 'Bounty blocklist is empty.', flags: MessageFlags.Ephemeral });
      return;
    }
    const lines = await Promise.all(rows.slice(0, 25).map(async (r) => {
      const u = await getUserByDiscord(r.discord_id);
      const name = u?.mc_name ? String(u.mc_name).replace(/^\./, '') : '?';
      const reason = r.reason ? ` — ${r.reason}` : '';
      return `• <@${r.discord_id}> (\`${name}\`)${reason}`;
    }));
    await interaction.reply({ content: `**Blocklist (${rows.length}):**\n${lines.join('\n')}`, flags: MessageFlags.Ephemeral });
  }
}
