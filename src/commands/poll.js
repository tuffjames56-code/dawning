// Quick poll: posts an embed with up to 5 vote buttons. Click to register
// your vote; click again to switch. The embed updates live with tallies.
//
// State lives in-message: customId pattern `poll:vote:<messageId>:<optionIdx>`,
// and votes are stored in-memory keyed by message id. Polls don't survive a
// bot restart — fine for the casual "what's for lunch" use case.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { buttonHandlers } from '../panels/registry.js';

// message_id -> { question, options: [{label, voters: Set<discord_id>}], hostId, endsAt? }
const polls = new Map();

export const data = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Create a quick poll.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
  .addStringOption((o) => o.setName('question').setDescription('Poll question').setRequired(true).setMaxLength(200))
  .addStringOption((o) => o.setName('options').setDescription('2-5 options separated by "|"').setRequired(true).setMaxLength(500));

export async function execute(interaction) {
  const question = interaction.options.getString('question').trim();
  const optionsRaw = interaction.options.getString('options');
  const options = optionsRaw.split('|').map((s) => s.trim()).filter(Boolean);

  if (options.length < 2 || options.length > 5) {
    await interaction.reply({ content: 'Provide 2-5 options separated by `|` (e.g. `pizza|tacos|sushi`).', flags: MessageFlags.Ephemeral });
    return;
  }

  // Defer publicly so the poll message is the reply itself.
  await interaction.deferReply();
  const sent = await interaction.fetchReply();
  const messageId = sent.id;

  polls.set(messageId, {
    question,
    hostId: interaction.user.id,
    options: options.map((label) => ({ label, voters: new Set() })),
  });

  await sent.edit(renderPoll(messageId));
}

function renderPoll(messageId) {
  const p = polls.get(messageId);
  if (!p) return { content: 'Poll expired.', embeds: [], components: [] };

  const total = p.options.reduce((acc, o) => acc + o.voters.size, 0);
  const lines = p.options.map((o, i) => {
    const pct = total === 0 ? 0 : Math.round((o.voters.size / total) * 100);
    const bar = renderBar(pct);
    return `**${i + 1}.** ${o.label} — ${o.voters.size} (${pct}%)\n\`${bar}\``;
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📊 ${p.question}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Started by ${p.hostId ? `<@${p.hostId}>` : 'someone'} · ${total} votes` });

  const row = new ActionRowBuilder().addComponents(
    p.options.map((_, i) =>
      new ButtonBuilder()
        .setCustomId(`poll:vote:${messageId}:${i}`)
        .setLabel(String(i + 1))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components: [row] };
}

function renderBar(pct) {
  const width = 20;
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

buttonHandlers.set('poll:vote', async (interaction, messageId, optionIdxStr) => {
  const p = polls.get(messageId);
  if (!p) {
    await interaction.reply({ content: 'That poll is no longer tracked (bot restarted?).', flags: MessageFlags.Ephemeral });
    return;
  }
  const idx = parseInt(optionIdxStr, 10);
  if (!Number.isInteger(idx) || idx < 0 || idx >= p.options.length) {
    await interaction.reply({ content: 'Invalid option.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Remove from any previous option, add to the chosen one. If they click
  // their existing option, treat it as "un-vote".
  const userId = interaction.user.id;
  let revote = true;
  for (const o of p.options) o.voters.delete(userId);
  if (!p.options[idx].voters.has(userId)) {
    p.options[idx].voters.add(userId);
  } else {
    revote = false;
  }

  await interaction.update(renderPoll(messageId));
  // Discord auto-replies via update; no extra ephemeral needed.
  void revote; // reserved for future "you cleared your vote" UX
});
