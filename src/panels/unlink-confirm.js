// Button handlers for the /unlink confirmation dialog. The dialog itself is
// posted by src/commands/unlink.js as an ephemeral message; only the original
// user can interact with it, so the customIds don't need to encode identity.

import { buttonHandlers } from './registry.js';
import { getUserByDiscord } from '../db/queries.js';
import { cascadeUnlink } from '../systems/linking/cascade-unlink.js';
import { logger } from '../utils/logger.js';

const log = logger.child('panels/unlink-confirm');

buttonHandlers.set('unlink:cancel', async (interaction) => {
  await interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
});

buttonHandlers.set('unlink:confirm', async (interaction) => {
  // Component interactions have a 3s ack budget; the cascade hits the MC server + Discord
  // and easily exceeds that. update() clears the buttons immediately and we
  // editReply() with the final result once the cascade settles.
  await interaction.update({ content: 'Unlinking...', embeds: [], components: [] });

  try {
    // Re-fetch state - between command and click, the user could have been
    // sponsored, banned, etc. Re-validate the gates that mattered.
    const user = await getUserByDiscord(interaction.user.id);
    if (!user || user.status === 'none') {
      await interaction.editReply('Your account is already unlinked.');
      return;
    }
    if (user.status === 'banned') {
      await interaction.editReply(`Banned users can't unlink. Contact an admin.`);
      return;
    }

    const { cooldownUntil } = await cascadeUnlink({
      user,
      discordClient: interaction.client,
    });
    const unix = Math.floor(cooldownUntil.getTime() / 1000);
    await interaction.editReply(
      `✓ Your account has been unlinked. You can re-link <t:${unix}:R>.`,
    );
  } catch (e) {
    log.error('cascade-unlink failed:', e);
    await interaction.editReply(
      `Something went wrong during unlink. Some cleanup may be incomplete — contact an admin if you see issues.`,
    );
  }
});
