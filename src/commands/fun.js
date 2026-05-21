import { SlashCommandBuilder } from 'discord.js';

const EIGHT_BALL = [
  'It is certain.', 'Without a doubt.', 'Yes, definitely.', 'You may rely on it.',
  'As I see it, yes.', 'Most likely.', 'Outlook good.', 'Yes.', 'Signs point to yes.',
  'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.',
  'Cannot predict now.', 'Concentrate and ask again.',
  'Don\'t count on it.', 'My reply is no.', 'My sources say no.',
  'Outlook not so good.', 'Very doubtful.',
];

export const data = new SlashCommandBuilder()
  .setName('fun')
  .setDescription('Quick random commands.')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('coinflip').setDescription('Flip a coin.'))
  .addSubcommand((s) => s.setName('dice').setDescription('Roll dice (default 1d6).')
    .addIntegerOption((o) => o.setName('count').setDescription('How many dice (1-10)').setMinValue(1).setMaxValue(10))
    .addIntegerOption((o) => o.setName('sides').setDescription('How many sides per die (2-100)').setMinValue(2).setMaxValue(100)))
  .addSubcommand((s) => s.setName('8ball').setDescription('Ask the magic 8-ball.')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(200)));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'coinflip') {
    const heads = Math.random() < 0.5;
    await interaction.reply(heads ? '🪙 **Heads**' : '🪙 **Tails**');
    return;
  }

  if (sub === 'dice') {
    const count = interaction.options.getInteger('count') ?? 1;
    const sides = interaction.options.getInteger('sides') ?? 6;
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    const detail = count === 1 ? `**${rolls[0]}**` : `${rolls.join(' + ')} = **${total}**`;
    await interaction.reply(`🎲 ${count}d${sides}: ${detail}`);
    return;
  }

  if (sub === '8ball') {
    const q = interaction.options.getString('question');
    const a = EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)];
    await interaction.reply(`🎱 **Q:** ${q}\n**A:** ${a}`);
  }
}
