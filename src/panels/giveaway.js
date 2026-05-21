// Side-effect: registers the entry button handler for giveaway embeds.

import { MessageFlags } from 'discord.js';
import { buttonHandlers } from './registry.js';
import { recordEntry } from '../systems/giveaways/actions.js';

buttonHandlers.set('giveaway:enter', async (interaction, idArg) => {
  const giveawayId = Number(idArg);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await recordEntry(giveawayId, interaction.user.id, { discordClient: interaction.client });
  if (!result.ok) {
    const messages = {
      not_found:       'That giveaway no longer exists.',
      closed:          'That giveaway is closed.',
      already_entered: 'You\'re already entered. Good luck!',
    };
    await interaction.editReply(messages[result.reason] ?? `Couldn't enter: ${result.reason}`);
    return;
  }
  await interaction.editReply('✓ You\'re entered. Good luck!');
});
