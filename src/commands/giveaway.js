import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } from 'discord.js';
import { requireAdmin } from '../utils/admin-gate.js';
import { startGiveaway, drawGiveaway, rerollGiveaway, adminCancelGiveaway } from '../systems/giveaways/actions.js';

// Parse "10m", "2h", "1d 6h" etc into milliseconds. Returns null on invalid.
function parseDuration(input) {
  const re = /(\d+)\s*([smhd])/gi;
  let total = 0; let m;
  while ((m = re.exec(input)) !== null) {
    const n = parseInt(m[1], 10);
    const u = m[2].toLowerCase();
    if (!Number.isInteger(n) || n <= 0) return null;
    total += n * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[u];
  }
  return total > 0 ? total : null;
}

export const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Admin: create, end, reroll, or cancel a giveaway.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) => s.setName('create').setDescription('Start a new giveaway.')
    .addStringOption((o) => o.setName('prize').setDescription('What\'s being given away').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('duration').setDescription('e.g. 30m, 2h, 1d 6h').setRequired(true).setMaxLength(20))
    .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(50))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in (defaults to here)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand((s) => s.setName('end').setDescription('End a giveaway early and draw winners.')
    .addIntegerOption((o) => o.setName('id').setDescription('Giveaway id').setRequired(true)))
  .addSubcommand((s) => s.setName('reroll').setDescription('Pick a new winner for an already-ended giveaway.')
    .addIntegerOption((o) => o.setName('id').setDescription('Giveaway id').setRequired(true)))
  .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a giveaway without drawing winners.')
    .addIntegerOption((o) => o.setName('id').setDescription('Giveaway id').setRequired(true)));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();

  if (sub === 'create') {
    const prize    = interaction.options.getString('prize');
    const duration = interaction.options.getString('duration');
    const winners  = interaction.options.getInteger('winners') ?? 1;
    const channel  = interaction.options.getChannel('channel') ?? interaction.channel;

    const ms = parseDuration(duration);
    if (!ms) {
      await interaction.reply({ content: 'Couldn\'t parse the duration. Try `30m`, `2h`, `1d 6h`.', flags: MessageFlags.Ephemeral });
      return;
    }
    try {
      const g = await startGiveaway({
        discordClient: interaction.client,
        channel,
        hostDiscordId: interaction.user.id,
        prize,
        durationMs: ms,
        winnersCount: winners,
      });
      await interaction.reply({ content: `✓ Giveaway #${g.id} started in <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
    } catch (e) {
      await interaction.reply({ content: `✗ ${e.message}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (sub === 'end') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = interaction.options.getInteger('id');
    const out = await drawGiveaway({ discordClient: interaction.client, giveawayId: id, force: true });
    if (!out.ok) { await interaction.editReply(`✗ ${out.reason}`); return; }
    await interaction.editReply(`✓ Giveaway #${id} ended (${out.winners.length} winner(s)).`);
    return;
  }

  if (sub === 'reroll') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = interaction.options.getInteger('id');
    const out = await rerollGiveaway({ discordClient: interaction.client, giveawayId: id });
    if (!out.ok) { await interaction.editReply(`✗ ${out.reason}`); return; }
    await interaction.editReply(`✓ Rerolled. New winner: <@${out.winner}>`);
    return;
  }

  if (sub === 'cancel') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = interaction.options.getInteger('id');
    const out = await adminCancelGiveaway({ discordClient: interaction.client, giveawayId: id });
    if (!out.ok) { await interaction.editReply(`✗ ${out.reason}`); return; }
    await interaction.editReply(`✓ Giveaway #${id} cancelled.`);
  }
}
