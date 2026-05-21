// User-facing bounty panel posted in BOUNTY_CHANNEL_ID via /bounty-setup.
//
// Placement is a multi-step ephemeral flow because Discord modals only support
// text inputs (no selects inside a modal). Flow:
//
//   1. Click "Place Bounty"                 -> ephemeral with two select menus
//   2. Pick duration                        -> updates message, encodes choice
//   3. Pick reward item                     -> updates message, encodes choice
//   4. Click "Set amount & target"          -> opens modal
//   5. Modal: target MC username + amount   -> submit creates bounty + deposit session
//
// customId map:
//   bounty:open-modal                              -> step 1
//   bounty:pick-duration                           -> select submit (step 2)
//   bounty:pick-item                               -> select submit (step 3)
//   bounty:continue:<durIdx>:<itemId...>           -> step 4 button -> opens modal
//   bounty:submit:<durIdx>:<itemId...>             -> modal submit (step 5)
//   bounty:list-active                             -> View Active button
//   bounty:cancel:<id>                             -> per-bounty cancel
//   bounty:claim:<id>                              -> per-bounty claim (link required)
//
// Item IDs contain `:` (e.g. minecraft:diamond) which collides with our
// customId separator. The registry's greedy prefix match means a customId
// like "bounty:continue:2:minecraft:diamond" resolves to handler "bounty:continue"
// with args ["2","minecraft","diamond"], which we re-join to "minecraft:diamond".

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { buttonHandlers, modalHandlers, selectMenuHandlers } from './registry.js';
import {
  getUserByDiscord,
  getUserByMcName,
  isBountyBlocked,
  getBountyCooldown,
  getActiveBounties,
  getActiveBountiesByTarget,
  createBounty,
  getBounty,
} from '../db/queries.js';
import { startDepositSession } from '../systems/bounty/deposit.js';
import { cancelBounty, claimBountyPayout, buildBountyEmbed } from '../systems/bounty/actions.js';
import { env, BOUNTY } from '../utils/config.js';
import { getSetting } from '../systems/settings/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('panels/bounty');

// ----- panel -----

export function buildBountyPanel() {
  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('💰 Bounty Board')
    .setDescription(
      `Place a bounty on a player. Pick how long it stays open, what you're putting up as a reward, then bring those items to the bot in-game.\n\n` +
      `**Place Bounty** — start the placement flow.\n` +
      `**View Active** — current open bounties.\n\n` +
      `_The killer must be linked to claim the reward._`,
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bounty:open-modal').setLabel('Place Bounty').setEmoji('💰').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('bounty:list-active').setLabel('View Active').setEmoji('📜').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

// ----- helpers: encode/decode the picked state -----

function parseAllowedItems() {
  const raw = getSetting('bounty_allowed_items') || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function prettyItemName(id) {
  // "minecraft:enchanted_golden_apple" -> "Enchanted Golden Apple"
  const path = id.includes(':') ? id.split(':').slice(1).join(':') : id;
  return path.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function readState(message) {
  // Look at the Continue button to recover the previously-picked duration/item.
  for (const row of message?.components ?? []) {
    for (const c of row.components ?? []) {
      const cid = c.customId ?? c.custom_id;
      if (cid?.startsWith('bounty:continue:')) {
        const parts = cid.split(':');
        // bounty : continue : <durIdx> : <itemNamespace> : <itemPath>
        // durIdx may be '-' (unpicked) and item may be '-' too.
        const durRaw = parts[2];
        const itemRaw = parts.slice(3).join(':');
        return {
          durationIdx: durRaw === '-' || durRaw === '' ? null : parseInt(durRaw, 10),
          itemId:      itemRaw === '-' || itemRaw === '' ? null : itemRaw,
        };
      }
    }
  }
  return { durationIdx: null, itemId: null };
}

function buildPlacementPayload({ durationIdx, itemId }) {
  const durLabel = durationIdx !== null ? BOUNTY.DURATIONS[durationIdx]?.label ?? '?' : '_not picked_';
  const itemLabel = itemId ? prettyItemName(itemId) : '_not picked_';

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('💰 Place a Bounty (Step 1 of 2)')
    .setDescription(
      `Pick a duration and a reward item. Then click **Set amount & target** to enter the target and how many of that item you're putting up.\n\n` +
      `**Duration:** ${durLabel}\n` +
      `**Reward item:** \`${itemId ?? '—'}\` (${itemLabel})`,
    );

  // ----- selects -----
  const durationSelect = new StringSelectMenuBuilder()
    .setCustomId('bounty:pick-duration')
    .setPlaceholder('Choose duration')
    .addOptions(BOUNTY.DURATIONS.map((d, i) => ({
      label: d.label,
      value: String(i),
      default: durationIdx === i,
    })));

  const allowed = parseAllowedItems();
  if (allowed.length === 0) {
    // Defensive: no items configured. Show an embed-only error.
    embed.setDescription('No reward items are configured. Ask an admin to set `bounty_allowed_items`.');
    return { embeds: [embed], components: [], flags: MessageFlags.Ephemeral };
  }
  const itemSelect = new StringSelectMenuBuilder()
    .setCustomId('bounty:pick-item')
    .setPlaceholder('Choose reward item')
    .addOptions(allowed.slice(0, 25).map((id) => ({
      label: prettyItemName(id).slice(0, 100),
      value: id.slice(0, 100),
      default: itemId === id,
    })));

  // ----- continue button -----
  const ready = durationIdx !== null && itemId !== null;
  const continueId = `bounty:continue:${durationIdx ?? '-'}:${itemId ?? '-'}`;
  const continueBtn = new ButtonBuilder()
    .setCustomId(continueId)
    .setLabel(ready ? 'Set amount & target →' : 'Pick duration + item first')
    .setStyle(ready ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(!ready);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(durationSelect),
      new ActionRowBuilder().addComponents(itemSelect),
      new ActionRowBuilder().addComponents(continueBtn),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

// ----- Step 1: opening the placement flow -----

buttonHandlers.set('bounty:open-modal', async (interaction) => {
  const block = await reasonPosterCantPlace(interaction.user.id);
  if (block) {
    await interaction.reply({ content: block, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply(buildPlacementPayload({ durationIdx: null, itemId: null }));
});

// ----- Step 2 + 3: picking duration / item -----

selectMenuHandlers.set('bounty:pick-duration', async (interaction) => {
  const prev = readState(interaction.message);
  const durationIdx = parseInt(interaction.values[0], 10);
  await interaction.update(buildPlacementPayload({ durationIdx, itemId: prev.itemId }));
});

selectMenuHandlers.set('bounty:pick-item', async (interaction) => {
  const prev = readState(interaction.message);
  const itemId = interaction.values[0];
  await interaction.update(buildPlacementPayload({ durationIdx: prev.durationIdx, itemId }));
});

// ----- Step 4: Continue → opens modal -----

buttonHandlers.set('bounty:continue', async (interaction, durIdxArg, ...itemParts) => {
  const durationIdx = parseInt(durIdxArg, 10);
  const itemId = itemParts.join(':');

  if (!Number.isInteger(durationIdx) || !itemId || itemId === '-') {
    await interaction.reply({ content: 'Pick a duration and an item first.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Re-validate the user can still place.
  const block = await reasonPosterCantPlace(interaction.user.id);
  if (block) {
    await interaction.reply({ content: block, flags: MessageFlags.Ephemeral });
    return;
  }

  const itemLabel = prettyItemName(itemId);
  const modal = new ModalBuilder()
    .setCustomId(`bounty:submit:${durationIdx}:${itemId}`)
    .setTitle(`Bounty: ${itemLabel}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('target_mc')
          .setLabel('Target MC username')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('amount')
          .setLabel(`Amount of ${itemLabel} to put up`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(5)
          .setPlaceholder('e.g. 8'),
      ),
    );
  await interaction.showModal(modal);
});

// ----- Step 5: modal submit -----

modalHandlers.set('bounty:submit', async (interaction, durIdxArg, ...itemParts) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const durationIdx = parseInt(durIdxArg, 10);
  const itemId = itemParts.join(':');
  const duration = BOUNTY.DURATIONS[durationIdx];
  if (!duration || !itemId) {
    await interaction.editReply('Invalid duration or item. Re-open the placement panel.');
    return;
  }

  // Sanity: item must still be in the allowed list (admin may have edited it).
  if (!parseAllowedItems().includes(itemId)) {
    await interaction.editReply(`\`${itemId}\` is no longer an allowed reward item. Re-open the panel.`);
    return;
  }

  const block = await reasonPosterCantPlace(interaction.user.id);
  if (block) { await interaction.editReply(block); return; }

  const poster = await getUserByDiscord(interaction.user.id);
  const targetInput = interaction.fields.getTextInputValue('target_mc').trim();
  const amountInput = interaction.fields.getTextInputValue('amount').trim();

  // Target validation.
  const target = await getUserByMcName(targetInput);
  if (!target)                                                                         { await interaction.editReply(`\`${targetInput}\` isn't linked. The target must have a linked Discord account.`); return; }
  if (target.status === 'banned')                                                       { await interaction.editReply(`\`${target.mc_name}\` is banned and can't be bountied.`); return; }
  if (await isBountyBlocked(target.discord_id))                                         { await interaction.editReply(`\`${target.mc_name}\` is on the bounty blocklist.`); return; }
  if (!getSetting('bounty_self_allowed') && target.discord_id === interaction.user.id)  { await interaction.editReply('You can\'t place a bounty on yourself.'); return; }

  // Target cooldown.
  const cd = await getBountyCooldown(target.discord_id);
  if (cd) {
    const ready = new Date(cd.last_bountied_at).getTime() + getSetting('bounty_target_cooldown_hours') * 60 * 60 * 1000;
    if (ready > Date.now()) {
      const unix = Math.floor(ready / 1000);
      await interaction.editReply(`\`${target.mc_name}\` was recently bountied. Try again <t:${unix}:R>.`);
      return;
    }
  }

  // Concurrent-bounty cap.
  const existingOnTarget = await getActiveBountiesByTarget(target.discord_id);
  const maxAtOnce = getSetting('bounty_max_targets_at_once');
  if (existingOnTarget.length >= maxAtOnce) {
    await interaction.editReply(`\`${target.mc_name}\` already has ${existingOnTarget.length}/${maxAtOnce} active bounties.`);
    return;
  }

  // Amount validation.
  const amount = parseInt(amountInput, 10);
  if (!Number.isInteger(amount) || amount < 1 || amount > 9999) {
    await interaction.editReply('Amount must be a whole number between 1 and 9999.');
    return;
  }

  const expiresAt = new Date(Date.now() + duration.ms);

  try {
    const bounty = await createBounty({
      posterDiscordId: interaction.user.id,
      targetDiscordId: target.discord_id,
      targetMcName:    target.mc_name,
      expiresAt,
    });
    await startDepositSession({
      bounty,
      posterMcName: poster.mc_name,
      declaredReward: { itemId, count: amount },
    });

    const display = String(target.mc_name).replace(/^\./, '');
    await interaction.editReply(
      `✓ Bounty #${bounty.id} on \`${display}\` created.\n` +
      `**Reward:** ${amount}× ${prettyItemName(itemId)} (\`${itemId}\`)\n` +
      `**Duration:** ${duration.label}\n\n` +
      `**Now in-game:**\n` +
      `1. Run \`/tpa ${env.mc.username}\` to teleport to the bot.\n` +
      `2. Drop the reward items near the bot.\n` +
      `3. Type \`done\` in chat to finalise, or \`cancel\` to abort.\n\n` +
      `Session times out after ${getSetting('bounty_deposit_timeout_minutes')} minutes of inactivity, ` +
      `or if you log out, die, or walk more than ${getSetting('bounty_deposit_distance_blocks')} blocks from the bot.`,
    );
  } catch (e) {
    log.error('bounty placement failed:', e);
    await interaction.editReply(`✗ ${e.message}`);
  }
});

// ----- shared validation -----

async function reasonPosterCantPlace(discordId) {
  if (getSetting('maintenance_mode')) return 'Bounty placement is currently disabled (maintenance mode).';
  if (!env.discord.bountyChannelId) return 'Bounty channel is not configured. Ask an admin.';
  const user = await getUserByDiscord(discordId);
  if (!user || user.status === 'none') return 'Link your MC account first via the verify panel.';
  if (user.status === 'banned')        return 'You can\'t place bounties.';
  if (!user.mc_name)                   return 'Your MC username is not on file. Re-run /link.';
  return null;
}

// ----- View Active -----

buttonHandlers.set('bounty:list-active', async (interaction) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const bounties = await getActiveBounties();
  if (!bounties.length) {
    await interaction.editReply('No active bounties right now.');
    return;
  }
  const lines = bounties.slice(0, 25).map((b) => {
    const display = String(b.target_mc_name ?? '?').replace(/^\./, '');
    const expires = b.expires_at ? `<t:${Math.floor(new Date(b.expires_at).getTime() / 1000)}:R>` : 'no expiry';
    return `• **#${b.id}** \`${display}\` — expires ${expires}`;
  });
  await interaction.editReply(`**Active bounties (${bounties.length}):**\n${lines.join('\n')}`);
});

// ----- Cancel button -----

buttonHandlers.set('bounty:cancel', async (interaction, bountyId) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await cancelBounty({
    bountyId: Number(bountyId),
    actorDiscordId: interaction.user.id,
    discordClient: interaction.client,
  });
  if (!result.ok) {
    const messages = {
      not_found:  'That bounty no longer exists.',
      not_poster: 'Only the bounty poster can cancel it.',
      race:       'That bounty changed state — refresh and try again.',
    };
    await interaction.editReply(messages[result.reason] ?? `Couldn't cancel: ${result.reason}`);
    return;
  }
  await interaction.editReply(
    `✓ Bounty #${bountyId} cancelled. ` +
    `Check your DMs for the refund details (the bot will tell you in-game too if \`/give\` had any trouble).`,
  );
});

// ----- Claim button (linked-killer path for delayed payout) -----

buttonHandlers.set('bounty:claim', async (interaction, bountyId) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const bounty = await getBounty(Number(bountyId));
  if (!bounty) { await interaction.editReply('That bounty no longer exists.'); return; }
  if (bounty.claimed_by_discord_id && bounty.claimed_by_discord_id !== interaction.user.id) {
    await interaction.editReply('That bounty was claimed by someone else.');
    return;
  }
  const result = await claimBountyPayout({
    bountyId: Number(bountyId),
    killerDiscordId: interaction.user.id,
    discordClient: interaction.client,
  });
  if (!result.ok) {
    const messages = {
      not_completed:     'That bounty isn\'t in a claimable state.',
      already_claimed:   'That bounty was already paid out.',
      killer_not_linked: 'Link your MC account first, then click again.',
    };
    await interaction.editReply(messages[result.reason] ?? `Couldn't claim: ${result.reason}`);
    return;
  }
  await interaction.editReply(`✓ Payout for bounty #${bountyId} delivered in-game.`);
});

export { buildBountyEmbed };
