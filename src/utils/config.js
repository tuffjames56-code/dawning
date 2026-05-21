// Centralised env access. Runtime-tunable thresholds (sponsor/strike/link/etc.)
// moved out to src/systems/settings/ - call getSetting('key') instead of
// importing constants from here.

import 'dotenv/config';

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function opt(name, fallback = undefined) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return v.trim();
}

function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} is not a number: ${v}`);
  return n;
}

export const env = {
  discord: {
    token:    req('DISCORD_TOKEN'),
    clientId: req('DISCORD_CLIENT_ID'),
    guildId:  req('DISCORD_GUILD_ID'),
    sponsorChannelId:         opt('SPONSOR_CHANNEL_ID'),
    bountyChannelId:          opt('BOUNTY_CHANNEL_ID'),
    bountyRoleId:             opt('BOUNTY_ROLE_ID'),
    adminRoleId:              opt('ADMIN_ROLE_ID'),
    trustedRoleId:            opt('TRUSTED_ROLE_ID'),
    sponseeRoleId:            opt('SPONSEE_ROLE_ID'),
    // Auto-assigned on link, removed on /unlink. Discord-side gate only -
    // does not affect MC server access.
    verifiedRoleId:           opt('VERIFIED_ROLE_ID'),
    adminLogChannelId:        opt('ADMIN_LOG_CHANNEL_ID'),
    // Phase 2 channels
    verifyChannelId:          opt('VERIFY_CHANNEL_ID'),
    requestSponsorChannelId:  opt('REQUEST_SPONSOR_CHANNEL_ID'),
    sponsorRequestsChannelId: opt('SPONSOR_REQUESTS_CHANNEL_ID'),
    adminPanelChannelId:      opt('ADMIN_PANEL_CHANNEL_ID'),
    // Modmail: per-user threads get created in this channel when someone
    // DMs or @-mentions the bot. Admin replies in those threads relay back
    // to the user. Leave empty to disable modmail.
    modmailChannelId:         opt('MODMAIL_CHANNEL_ID'),
    // Anti-leech: list of guild IDs this bot instance is allowed to operate
    // in. If the bot is added to anything else, it auto-leaves. Defaults to
    // DISCORD_GUILD_ID when unset (single-guild deployment). Comma-separated.
    allowedGuildIds:          opt('ALLOWED_GUILD_IDS'),
  },
  servers: {
    // User-facing MC server addresses, embedded in DMs / kick messages.
    verifyAddress: opt('VERIFY_SERVER_ADDRESS', ''),
    mainAddress:   opt('MAIN_SERVER_ADDRESS', ''),
    // Bedrock-friendly entry: the MCXboxBroadcast gamertag players add as
    // a friend on Xbox Live, then "Join" from their friends list. Empty
    // means "Bedrock support not configured yet" - the DM degrades gracefully.
    bedrockFriendName: opt('BEDROCK_FRIEND_NAME', ''),
  },
  api: {
    // HTTP endpoint the verify-mod calls. Bind to 0.0.0.0 implicitly.
    // PORT is set by Railway/Render automatically; MOD_API_PORT is the local
    // override (default 3001). Prefer the platform-provided one on deploy.
    port:   num('PORT', num('MOD_API_PORT', 3001)),
    secret: req('MOD_API_SECRET'),
    // Optional. If set, the /github webhook route verifies the X-Hub-
    // Signature-256 header against this secret and rejects spoofed POSTs.
    githubSecret: opt('GITHUB_WEBHOOK_SECRET'),
  },
  luckperms: {
    // LuckPerms group names the sponsor system grants via the in-game bot.
    // Override per-deployment without touching code.
    sponseeGroup: opt('LP_SPONSEE_GROUP', 'sponsee'),
    trustedGroup: opt('LP_TRUSTED_GROUP', 'trusted'),
  },
  supabase: {
    url: req('SUPABASE_URL'),
    key: req('SUPABASE_KEY'),
  },
  mc: {
    host:     req('MC_SERVER_HOST'),
    port:     num('MC_SERVER_PORT', 25565),
    username: req('MC_BOT_USERNAME'),
    auth:     opt('MC_BOT_AUTH', 'microsoft'),
    home: {
      x: num('MC_BOT_HOME_X', null),
      y: num('MC_BOT_HOME_Y', null),
      z: num('MC_BOT_HOME_Z', null),
    },
  },
  rcon: {
    host:     opt('RCON_HOST'),
    port:     num('RCON_PORT', 25575),
    password: opt('RCON_PASSWORD'),
  },
};

// Phase 3 (bounty) compile-time data that doesn't fit the settings shape:
// fixed duration menu used in the bounty placement select, and the background
// expiry check cadence. These can graduate to settings later if needed.
export const BOUNTY = {
  EXPIRY_CHECK_INTERVAL_MS: 30_000,
  DURATIONS: [
    { label: '1 hour',  ms: 1 * 60 * 60 * 1000 },
    { label: '6 hours', ms: 6 * 60 * 60 * 1000 },
    { label: '1 day',   ms: 24 * 60 * 60 * 1000 },
    { label: '3 days',  ms: 3 * 24 * 60 * 60 * 1000 },
    { label: '7 days',  ms: 7 * 24 * 60 * 60 * 1000 },
  ],
};
