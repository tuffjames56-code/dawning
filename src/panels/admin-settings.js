// Settings subpanel. Iterates the registered settings dynamically via
// listSettings() so new entries in defaults.js appear here automatically.
//
// Flow:
//   admin:open:settings              -> render select menu (this file)
//   admin:settings:select             -> select menu submit -> detail view
//   admin:settings:set:<key>          -> button -> open modal
//   admin:settings:set-submit:<key>   -> modal submit -> setSetting + result
//   admin:settings:reset:<key>        -> button -> resetSetting + result
//   admin:settings:back               -> button -> back to select menu

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { buttonHandlers, modalHandlers, selectMenuHandlers } from './registry.js';
import { requireAdmin } from '../utils/admin-gate.js';
import { listSettings, getSettingMeta, getSetting, setSetting, resetSetting } from '../systems/settings/index.js';

// Discord select menus cap at 25 options; we have 25 settings (sorted by
// category for usability). If that grows, switch to category-pick -> setting-pick.
function buildSelectMenu() {
  const all = listSettings().slice().sort((a, b) =>
    a.category.localeCompare(b.category) || a.key.localeCompare(b.key),
  );
  const options = all.slice(0, 25).map((s) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(s.key)
      .setValue(s.key)
      .setDescription(`[${s.category}] ${s.type}${s.overridden ? ' • overridden' : ''}`),
  );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin:settings:select')
      .setPlaceholder('Pick a setting to view or edit')
      .addOptions(options),
  );
}

export async function renderSettingsList(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⚙️ Settings')
    .setDescription(`${listSettings().length} settings registered. Pick one below to view or edit.`);

  await interaction.reply({
    embeds: [embed],
    components: [buildSelectMenu()],
    flags: MessageFlags.Ephemeral,
  });
}

function fmtValue(v) {
  if (typeof v === 'string') return `\`"${v}"\``;
  return `\`${JSON.stringify(v)}\``;
}

function renderDetail(key) {
  const meta = getSettingMeta(key);
  if (!meta) {
    return { embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('Unknown setting').setDescription(key)], components: [] };
  }
  const current = getSetting(key);

  const lines = [
    `**Type:** ${meta.type}`,
    `**Category:** ${meta.category}`,
    meta.min !== undefined ? `**Min:** ${meta.min}` : null,
    meta.max !== undefined ? `**Max:** ${meta.max}` : null,
    `**Default:** ${fmtValue(meta.defaultValue)}`,
    `**Current:** ${fmtValue(current)}`,
    '',
    meta.description || '_no description_',
  ].filter(Boolean);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`⚙️ ${key}`)
    .setDescription(lines.join('\n'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin:settings:set:${key}`).setLabel('Set Value').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin:settings:reset:${key}`).setLabel('Reset to Default').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:settings:back').setLabel('Back').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

// ----- handlers -----

selectMenuHandlers.set('admin:settings:select', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  const key = interaction.values[0];
  await interaction.update(renderDetail(key));
});

buttonHandlers.set('admin:settings:back', async (interaction) => {
  if (!(await requireAdmin(interaction))) return;
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('⚙️ Settings').setDescription('Pick a setting below.')],
    components: [buildSelectMenu()],
  });
});

buttonHandlers.set('admin:settings:set', async (interaction, key) => {
  if (!(await requireAdmin(interaction))) return;
  const meta = getSettingMeta(key);
  if (!meta) {
    await interaction.reply({ content: `Unknown setting: ${key}`, flags: MessageFlags.Ephemeral });
    return;
  }
  const current = getSetting(key);
  const placeholder = meta.type === 'bool' ? 'true or false'
    : meta.type === 'string' ? 'any string'
    : `${meta.type}${meta.min !== undefined ? ` (min ${meta.min}` : ''}${meta.max !== undefined ? `, max ${meta.max})` : meta.min !== undefined ? ')' : ''}`;

  const modal = new ModalBuilder()
    .setCustomId(`admin:settings:set-submit:${key}`)
    .setTitle(`Set ${key}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('value')
          .setLabel('New value')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(placeholder.slice(0, 100))
          .setValue(typeof current === 'string' ? current : JSON.stringify(current))
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
});

modalHandlers.set('admin:settings:set-submit', async (interaction, key) => {
  if (!(await requireAdmin(interaction))) return;
  const raw = interaction.fields.getTextInputValue('value');
  try {
    const result = await setSetting(key, raw, interaction.user.id);
    await interaction.update(renderDetail(key));
    await interaction.followUp({
      content: `✓ Updated \`${key}\`: ${fmtValue(result.oldValue)} → ${fmtValue(result.newValue)}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (e) {
    await interaction.reply({
      content: `✗ Could not set \`${key}\`: ${e.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
});

buttonHandlers.set('admin:settings:reset', async (interaction, key) => {
  if (!(await requireAdmin(interaction))) return;
  try {
    const result = await resetSetting(key, interaction.user.id);
    await interaction.update(renderDetail(key));
    await interaction.followUp({
      content: result.wasOverridden
        ? `✓ Reset \`${key}\` to default: ${fmtValue(result.newValue)}`
        : `\`${key}\` was already at default.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (e) {
    await interaction.reply({
      content: `✗ Could not reset \`${key}\`: ${e.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
});
