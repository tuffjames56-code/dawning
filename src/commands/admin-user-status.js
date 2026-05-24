import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { setUserStatus } from '../systems/users/admin-actions.js';
import { requireAdmin } from '../utils/admin-gate.js';

export const data = new SlashCommandBuilder()
  .setName('admin-user-status')
  .setDescription('Admin: force a user\'s status.')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
  .addStringOption((o) => o.setName('status').setDescription('New status').setRequired(true)
    .addChoices(
      { name: 'none', value: 'none' },
      { name: 'linked', value: 'linked' },
      { name: 'sponsee', value: 'sponsee' },
      { name: 'trusted', value: 'trusted' },
      { name: 'banned', value: 'banned' },
    ));

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const user = interaction.options.getUser('user');
  const status = interaction.options.getString('status');
  try {
    const r = await setUserStatus(user.id, status, interaction.user.id);
    let msg = `✓ <@${user.id}> status: ${r.before} → ${r.after}`;
    // Nudge the operator toward /admin-sponsor-punish when banning, since
    // this command is a raw force-set and doesn't cascade strikes or kick
    // the player in-game.
    if (status === 'banned') {
      msg += `\n\n_Heads up: this is a raw status override. No strike was applied to their sponsor, no in-game kick / whitelist removal happened. ` +
             `If you meant to discipline a sponsee for breaking a rule, use \`/admin-sponsor-punish\` instead — that bans them properly and strikes whoever vouched for them._`;
    }
    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  } catch (e) {
    await interaction.reply({ content: `✗ ${e.message}`, flags: MessageFlags.Ephemeral });
  }
}
