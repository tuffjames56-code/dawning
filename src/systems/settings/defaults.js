// Registers every setting the bot knows about. Called once at startup,
// before initSettings() loads overrides from the DB.
//
// Adding a setting:
//   1. registerSetting(...) here
//   2. Use getSetting('your_key') in code (no further wiring needed)
//   3. Admin panel + /admin-config-* commands pick it up automatically

import { registerSetting } from './index.js';
import { DEFAULT_SLUR_LIST } from '../../automod/default-slurs.js';

export function registerDefaults() {
  // ----- Linking -----
  registerSetting({ key: 'link_code_ttl_minutes',         category: 'linking', type: 'int',  defaultValue: 5,     min: 1,    max: 60,     description: 'How long a /link code stays valid (minutes).' });
  registerSetting({ key: 'unlink_cooldown_hours',         category: 'linking', type: 'int',  defaultValue: 24,    min: 0,    max: 720,    description: 'Cooldown after self-unlink before re-linking (hours).' });
  registerSetting({ key: 'already_linked_kick_delay_ms',  category: 'linking', type: 'int',  defaultValue: 1500,  min: 0,    max: 30000,  description: 'Delay before the verify-mod kicks an already-linked player (ms). Mod-side; bot value is for parity reference only.' });
  registerSetting({ key: 'title_reminder_interval_ms',    category: 'linking', type: 'int',  defaultValue: 15000, min: 1000, max: 600000, description: 'Verify-server on-screen title re-send interval (ms). Mod-side; bot value is for parity reference only.' });
  registerSetting({ key: 'assign_verified_role',          category: 'linking', type: 'bool', defaultValue: true,                            description: 'Auto-assign the Verified Discord role on successful link.' });
  registerSetting({ key: 'send_link_dms',                 category: 'linking', type: 'bool', defaultValue: true,                            description: 'Send notification DMs for link/sponsor events.' });

  // ----- Sponsor -----
  registerSetting({ key: 'max_active_sponsees',           category: 'sponsor', type: 'int',  defaultValue: 1,     min: 1,    max: 10,     description: 'Active sponsees a single trusted member can hold.' });
  registerSetting({ key: 'auto_promote_days',             category: 'sponsor', type: 'int',  defaultValue: 15,    min: 1,    max: 365,    description: 'Days a sponsee must be clean before auto-promoting to trusted.' });
  registerSetting({ key: 'sponsor_remove_cooldown_hours', category: 'sponsor', type: 'int',  defaultValue: 24,    min: 0,    max: 720,    description: 'Cooldown before a sponsor can sponsor again after removing a sponsorship (hours).' });
  registerSetting({ key: 'sponsees_can_sponsor',          category: 'sponsor', type: 'bool', defaultValue: false,                          description: 'Whether sponsees may also sponsor others.' });

  // ----- Strikes -----
  registerSetting({ key: 'strike_minor',                  category: 'strikes', type: 'int',  defaultValue: 1,     min: 0,    max: 10,     description: 'Strikes added to sponsor on minor sponsee offense.' });
  registerSetting({ key: 'strike_major',                  category: 'strikes', type: 'int',  defaultValue: 2,     min: 0,    max: 10,     description: 'Strikes added to sponsor on major sponsee offense.' });
  registerSetting({ key: 'strike_decay_days',             category: 'strikes', type: 'int',  defaultValue: 30,    min: 1,    max: 365,    description: 'Strikes decay by 1 after this many clean days.' });
  registerSetting({ key: 'strike_threshold_suspend',      category: 'strikes', type: 'int',  defaultValue: 3,     min: 1,    max: 100,    description: 'Strike count at which a sponsor is suspended from sponsoring.' });
  registerSetting({ key: 'strike_suspend_days',           category: 'strikes', type: 'int',  defaultValue: 30,    min: 1,    max: 365,    description: 'Length of sponsoring suspension at the suspend threshold (days).' });
  registerSetting({ key: 'strike_threshold_ban',          category: 'strikes', type: 'int',  defaultValue: 5,     min: 1,    max: 100,    description: 'Strike count at which a sponsor is themselves banned.' });

  // ----- Request-a-sponsor -----
  registerSetting({ key: 'request_expiry_days',             category: 'request', type: 'int', defaultValue: 7,   min: 1,  max: 90,   description: 'Pending sponsor requests expire after this many days.' });
  registerSetting({ key: 'request_rejection_cooldown_hours', category: 'request', type: 'int', defaultValue: 24, min: 0,  max: 720,  description: 'Cooldown after a request is rejected or expires before re-applying (hours).' });
  registerSetting({ key: 'request_min_reason_chars',         category: 'request', type: 'int', defaultValue: 50, min: 1,  max: 1000, description: 'Minimum characters in a sponsor-request reason.' });
  registerSetting({ key: 'request_max_reason_chars',         category: 'request', type: 'int', defaultValue: 500, min: 50, max: 4000, description: 'Maximum characters in a sponsor-request reason.' });

  // ----- Bounty -----
  registerSetting({ key: 'bounty_default_duration_hours', category: 'bounty', type: 'int',  defaultValue: 24,    min: 1,    max: 720,    description: 'Default bounty duration when one isn\'t chosen (hours).' });
  registerSetting({ key: 'bounty_target_cooldown_hours',  category: 'bounty', type: 'int',  defaultValue: 24,    min: 0,    max: 720,    description: 'Cooldown after a bounty resolves before the target can be re-bountied (hours).' });
  registerSetting({ key: 'bounty_self_allowed',           category: 'bounty', type: 'bool', defaultValue: false,                          description: 'Whether a user may place a bounty on themselves.' });
  registerSetting({ key: 'bounty_deposit_timeout_minutes', category: 'bounty', type: 'int', defaultValue: 10,    min: 1,    max: 120,    description: 'Pending deposit sessions expire after this many minutes of inactivity.' });
  registerSetting({ key: 'bounty_max_targets_at_once',     category: 'bounty', type: 'int', defaultValue: 3,     min: 1,    max: 20,     description: 'Maximum concurrent active bounties on the same target.' });
  registerSetting({
    key: 'bounty_allowed_items', category: 'bounty', type: 'string',
    defaultValue: 'minecraft:diamond,minecraft:netherite_ingot,minecraft:netherite_scrap,minecraft:golden_apple,minecraft:enchanted_golden_apple,minecraft:nether_star,minecraft:totem_of_undying,minecraft:elytra,minecraft:emerald,minecraft:diamond_block,minecraft:netherite_block,minecraft:ancient_debris,minecraft:beacon',
    description: 'Comma-separated item IDs allowed as bounty rewards. Edit with /admin-config-set.',
  });
  registerSetting({ key: 'bounty_deposit_distance_blocks', category: 'bounty', type: 'int', defaultValue: 30,    min: 5,    max: 200,    description: 'If the poster walks farther than this from the bot during deposit, the session is cancelled.' });

  // ----- Auto-moderation -----
  registerSetting({ key: 'automod_enabled',                 category: 'automod', type: 'bool',   defaultValue: false, description: 'Master switch for message auto-moderation.' });
  registerSetting({ key: 'automod_slur_list',               category: 'automod', type: 'string', defaultValue: DEFAULT_SLUR_LIST, description: 'Comma-separated slur list. Matched case-insensitively after stripping leet substitutions, diacritics, and spacing-style bypasses. Ships with a curated starter list; edit freely. Set to empty to disable the slur filter.' });
  registerSetting({ key: 'automod_block_invites',           category: 'automod', type: 'bool',   defaultValue: true,  description: 'Delete messages containing Discord invite links (discord.gg / discord.com/invite).' });
  registerSetting({ key: 'automod_block_untrusted_links',   category: 'automod', type: 'bool',   defaultValue: false, description: 'Delete messages containing links whose domain isn\'t on the trusted list.' });
  registerSetting({ key: 'automod_trusted_domains',         category: 'automod', type: 'string', defaultValue: 'youtube.com,youtu.be,twitch.tv,github.com,tenor.com,giphy.com,imgur.com,discord.com,reddit.com,twitter.com,x.com,mc-heads.net,minecraft.net', description: 'Comma-separated allowed domains. Subdomains are matched (e.g. "youtube.com" also allows "m.youtube.com").' });
  registerSetting({ key: 'automod_spam_messages',           category: 'automod', type: 'int',    defaultValue: 5, min: 2, max: 50, description: 'Max messages per user inside the spam window before they trigger the spam rule.' });
  registerSetting({ key: 'automod_spam_window_seconds',     category: 'automod', type: 'int',    defaultValue: 5, min: 1, max: 300, description: 'Spam-detection sliding window length in seconds.' });
  registerSetting({ key: 'automod_timeout_minutes',         category: 'automod', type: 'int',    defaultValue: 5, min: 0, max: 1440, description: 'On violation, time the user out for this many minutes. Set 0 to only delete + warn without timing out.' });
  registerSetting({ key: 'automod_warn_dm',                 category: 'automod', type: 'bool',   defaultValue: true,  description: 'DM the user a brief explanation when their message gets removed.' });

  // ----- Welcome / Goodbye -----
  registerSetting({ key: 'welcome_enabled',    category: 'welcomer', type: 'bool',   defaultValue: false, description: 'Announce new members in the welcome channel.' });
  registerSetting({ key: 'welcome_channel_id', category: 'welcomer', type: 'string', defaultValue: '',    description: 'Channel id where welcome messages get posted.' });
  registerSetting({ key: 'welcome_message',    category: 'welcomer', type: 'string', defaultValue: '👋 Welcome to {server}, {user}! You\'re member #{count}.', description: 'Message body. Placeholders: {user} {username} {server} {count}' });
  registerSetting({ key: 'goodbye_enabled',    category: 'welcomer', type: 'bool',   defaultValue: false, description: 'Announce departing members.' });
  registerSetting({ key: 'goodbye_channel_id', category: 'welcomer', type: 'string', defaultValue: '',    description: 'Channel id where goodbye messages get posted.' });
  registerSetting({ key: 'goodbye_message',    category: 'welcomer', type: 'string', defaultValue: '🚪 {username} left {server}.', description: 'Message body. Placeholders: {user} {username} {server} {count}' });

  // ----- MC <-> Discord chat bridge -----
  registerSetting({ key: 'bridge_enabled',    category: 'bridge', type: 'bool',   defaultValue: false, description: 'Two-way chat bridge between MC public chat and a Discord channel.' });
  registerSetting({ key: 'bridge_channel_id', category: 'bridge', type: 'string', defaultValue: '',    description: 'Discord channel id to bridge with MC chat.' });

  // ----- Tickets -----
  registerSetting({ key: 'tickets_channel_id', category: 'tickets', type: 'string', defaultValue: '', description: 'Channel where the ticket panel lives + tickets get opened as threads under it.' });

  // ----- Changelog (GitHub webhook -> Discord embed) -----
  registerSetting({ key: 'changelog_enabled',    category: 'changelog', type: 'bool',   defaultValue: false, description: 'Post a clean embed to the changelog channel whenever GitHub pushes hit the webhook.' });
  registerSetting({ key: 'changelog_channel_id', category: 'changelog', type: 'string', defaultValue: '',    description: 'Channel id for changelog posts.' });
  registerSetting({ key: 'changelog_branches',   category: 'changelog', type: 'string', defaultValue: '',    description: 'Comma-separated branch names to post for. Empty = post all branches.' });

  // ----- System -----
  registerSetting({ key: 'maintenance_mode',              category: 'system',  type: 'bool',   defaultValue: false,                         description: 'When true, all new linking is blocked across /link, the verify panel, and the /verify HTTP endpoint.' });
  registerSetting({ key: 'allow_self_unlink',             category: 'system',  type: 'bool',   defaultValue: true,                          description: 'Whether users can run /unlink themselves. When false, only admins can unlink users.' });
  registerSetting({ key: 'bot_persona_name',              category: 'system',  type: 'string', defaultValue: 'Dawning',                     description: 'User-facing server/persona name shown in DMs and embeds.' });
  registerSetting({ key: 'bot_status_text',               category: 'system',  type: 'string', defaultValue: 'minecraft',                   description: 'Text after "Playing" in the bot\'s Discord presence. Empty disables the presence.' });
  registerSetting({ key: 'bot_status_type',               category: 'system',  type: 'string', defaultValue: 'playing',                     description: 'Presence verb: playing | watching | listening | competing.' });
}
