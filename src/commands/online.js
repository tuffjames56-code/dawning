import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { mc } from '../mineflayer/bot.js';
import { getUserByMcName } from '../db/queries.js';

export const data = new SlashCommandBuilder()
  .setName('online')
  .setDescription('List players currently in-game on the main server.')
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.deferReply();

  const bot = mc.bot;
  if (!bot || !bot.players) {
    await interaction.editReply('The in-game bot isn\'t connected right now.');
    return;
  }

  const usernames = Object.keys(bot.players).filter((n) => n !== bot.username);
  if (usernames.length === 0) {
    await interaction.editReply('Nobody else is online right now.');
    return;
  }

  // Look up Discord links per player; misses just show as bare MC name.
  const lines = await Promise.all(usernames.map(async (n) => {
    try {
      const u = await getUserByMcName(n);
      const display = String(n).replace(/^\./, '');
      return u?.discord_id
        ? `• \`${display}\` — <@${u.discord_id}>`
        : `• \`${display}\``;
    } catch {
      return `• \`${String(n).replace(/^\./, '')}\``;
    }
  }));

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle(`🟢 Online players (${usernames.length})`)
    .setDescription(lines.slice(0, 50).join('\n'));

  await interaction.editReply({ embeds: [embed] });
}
