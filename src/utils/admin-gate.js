// Runtime gate for admin actions. Discord permission flags on slash commands
// only hide the command from the UI; the actual authorization happens here so
// it's consistent across slash commands, buttons, modals, and select menus.

import { MessageFlags } from 'discord.js';
import { env } from './config.js';
import { logger } from './logger.js';

const log = logger.child('admin-gate');

// Looks for `roleId` on the interaction's member. If the cached snapshot
// doesn't list it, we re-fetch the live GuildMember once before giving up —
// covers the case where roles were granted after the bot's last cache update.
async function memberHasRole(interaction, roleId) {
  if (!interaction?.guild || !roleId) return false;
  // Fast path: cache.
  if (interaction.member?.roles?.cache?.has(roleId)) return true;
  // Slow path: live fetch.
  try {
    const fresh = await interaction.guild.members.fetch({
      user: interaction.user.id,
      force: true,
    });
    return fresh.roles.cache.has(roleId);
  } catch (e) {
    log.warn(`live member fetch failed for ${interaction.user.id}: ${e.message}`);
    return false;
  }
}

async function denyWithDiagnostic(interaction, role, configuredId) {
  // Dump everything we know about the interaction so the operator can see
  // why the check failed (typo in env? role hierarchy? unrelated guild?).
  try {
    const cachedRoleIds = interaction.member?.roles?.cache
      ? [...interaction.member.roles.cache.keys()]
      : [];
    log.warn(
      `${role} gate denied user ${interaction.user.tag} (${interaction.user.id}). ` +
      `Configured ${role.toUpperCase()}_ROLE_ID=${JSON.stringify(configuredId)}. ` +
      `Member role IDs at time of click: [${cachedRoleIds.join(', ')}].`,
    );
  } catch { /* swallow logging issues */ }
  await replyGate(interaction, `${role[0].toUpperCase() + role.slice(1)} role required.`);
}

export async function requireAdmin(interaction) {
  if (!env.discord.adminRoleId) {
    await replyGate(interaction, 'ADMIN_ROLE_ID is not configured on the bot.');
    return false;
  }
  if (!(await memberHasRole(interaction, env.discord.adminRoleId))) {
    await denyWithDiagnostic(interaction, 'admin', env.discord.adminRoleId);
    return false;
  }
  return true;
}

// Role gate used by the request-channel "Sponsor This Person" button. Faster
// than hitting the DB for status='trusted'; the deeper canSponsor() check
// runs after this passes.
export async function requireTrusted(interaction) {
  if (!env.discord.trustedRoleId) {
    await replyGate(interaction, 'TRUSTED_ROLE_ID is not configured on the bot.');
    return false;
  }
  if (!(await memberHasRole(interaction, env.discord.trustedRoleId))) {
    await denyWithDiagnostic(interaction, 'trusted', env.discord.trustedRoleId);
    return false;
  }
  return true;
}

async function replyGate(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content, embeds: [], components: [] });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}
