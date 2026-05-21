# Dawning: Minecraft Sponsor, Bounty & Community Bot

A full-service Discord bot for modded Fabric Minecraft servers. It's
designed around a two-server topology (a public **verification server**
for linking, and a whitelisted **main server** for play), and bundles:

- **Account linking** (Java + Bedrock) via a sibling Fabric mod
- **Sponsorship system** with strikes, auto-promotion, and decay
- **Item bounties** with in-game deposits, auto-payout, and refunds
- **Auto-moderation** (slurs, invites, link allowlist, spam)
- **Modmail, tickets, giveaways, polls, reaction roles**
- **MC ↔ Discord chat bridge**, **welcome/goodbye**, **info commands**

The bot speaks to Minecraft via a dedicated in-game OP account
(`mineflayer`), so it works on managed hosts that don't expose RCON
publicly.

---

## Architecture

```
                    ┌─────────────────────┐
                    │  Discord users      │
                    └──────────┬──────────┘
                               │ slash commands, buttons, DMs
                               ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Dawning (this bot)                                      │
   │  - discord.js v14   (Gateway + interactions)             │
   │  - mineflayer       (in-game OP account, sends commands) │
   │  - http (:PORT)     (verification mod calls this)        │
   │  - supabase-js      (Postgres)                           │
   └────────┬─────────────────────┬───────────────────────────┘
            │                     │ POST /verify
            │ /give /tp /effect   │
            │ /clear /whitelist   │ ┌──────────────────────┐
            │ /lp /kick           └─┤ Verification server  │
            ▼                       │ (Fabric + Geyser +   │
   ┌─────────────────────┐          │  Floodgate +         │
   │  Main MC server     │          │  verify-mod)         │
   │  (whitelisted)      │          └──────────────────────┘
   └─────────────────────┘
```

The bot is the central authority. Nothing else stores state. Supabase is
the database. Everything else (the in-game bot, the verification mod) is
stateless.

---

## Quick start

If you just want a checklist:

1. **Install** Node 22+ and clone this repo.
2. **Create a Supabase project**, then run all SQL files in
   [`migrations/`](migrations/) in order in the Supabase SQL editor.
3. **Create a Discord application + bot** at
   [discord.com/developers](https://discord.com/developers/applications),
   and enable the **SERVER MEMBERS** and **MESSAGE CONTENT** privileged
   intents.
4. **Set up a Microsoft account** for the in-game bot. This is the account
   that joins your MC server as `sdivz` or whatever name you pick. OP it
   on both the verification server and the main server.
5. **Build the verification mod** (see [`verify-server/README.md`](verify-server/README.md)).
6. **Stand up the verification server** with Geyser + Floodgate + verify-mod.
7. **Copy `.env.example` to `.env`** and fill in every value.
8. `npm install`
9. `npm run register` to publish slash commands to your guild.
10. `npm start` to launch the bot.
11. In Discord, run `/verify-setup`, `/sponsor-setup`,
    `/request-sponsor-setup`, `/bounty-setup`, `/ticket-setup`, and
    `/admin-setup` in their respective channels to post the persistent
    panels.

Each step is detailed below.

---

## Prerequisites

| Requirement | Why |
|---|---|
| **Node.js 22+** | `@supabase/realtime-js` requires native `WebSocket` |
| **Supabase project** | Postgres, plus where the migration SQL lives |
| **Discord application + bot** | Slash commands, panels, automod |
| **Microsoft account for the bot** | The bot logs into MC as a player via `mineflayer` |
| **Modded Fabric MC server** | The "main" server players actually play on |
| **A second Fabric MC server** | The verification server. Cheap; idles in a void world. |
| **LuckPerms (Fabric)** | Sponsor / trusted in-game groups |
| **Optional: managed MC host** | Works fine. RCON is not required. |

Java 21 is needed to build the verify-mod.

---

## Database setup

In the Supabase SQL editor, run each file from [`migrations/`](migrations/)
in numeric order:

```
001_init.sql              users, link_codes, bounty tables, sponsor_logs
002_phase2.sql            status='linked', sponsor_requests
003_unlink_cooldown.sql   cooldown column on users
004_settings.sql          settings + settings_audit
005_bot_blocklist.sql     bot-blocked users
006_giveaways.sql         giveaways + giveaway_entries
```

All migrations are idempotent and safe to re-run.

---

## Building the verification mod

The mod lives in a **sibling project** at `verify-mod/` (not inside this
repo). It exposes a `/verify <code>` command to players and POSTs the code
back to the bot's HTTP API. It also kicks already-linked players who try
to re-join the verification server.

### Build steps

```bash
cd ../verify-mod                          # adjust path to the sibling project
gradle wrapper                            # one-time, needs system Gradle 8.x
./gradlew build                           # produces build/libs/verify-mod-<ver>.jar
```

If you don't have Gradle installed, get it via
[SDKMAN](https://sdkman.io/) (`sdk install gradle 8.10`) or download from
[gradle.org](https://gradle.org/install/).

**Java 21** is required. Set `JAVA_HOME` accordingly if you have multiple
JDKs.

### Install on the verification server

Drop the built jar into the verification server's `mods/` folder:

```
mods/
  fabric-api-<version>.jar
  geyser-fabric.jar
  floodgate-fabric.jar
  verify-mod-1.0.0.jar
```

Edit `config/verify-mod.json` after first boot:

```json
{
  "mode": "verify_server",
  "botApiUrl": "https://your-bot.up.railway.app",
  "apiSecret": "must match MOD_API_SECRET in the bot's .env",
  "mainServerAddress": "play.example.com:25565"
}
```

`botApiUrl` is the publicly reachable address of the bot's HTTP API. If
you run the bot on Railway, it's the auto-generated domain. If you run it
locally, you'll need a tunnel (ngrok / cloudflared) during development.

See [`verify-server/README.md`](verify-server/README.md) for the rest of
the verification-server setup (Floodgate key sync, world generation,
`server.properties`).

---

## Environment variables

Copy [`.env.example`](.env.example) to `.env` and fill it in. Every
variable is documented in the example file. Grouped list:

### Discord

- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
- `ALLOWED_GUILD_IDS` (optional). Comma-separated list of guild IDs the
  bot is allowed to operate in. Defaults to `DISCORD_GUILD_ID`. Anything
  else, the bot leaves on join.

### Supabase

- `SUPABASE_URL`, `SUPABASE_KEY` (service-role)

### Minecraft (main server, where the bot lives)

- `MC_SERVER_HOST`, `MC_SERVER_PORT`
- `MC_BOT_USERNAME`, `MC_BOT_AUTH=microsoft`
- `MC_BOT_HOME_X/Y/Z` (optional idle home)

### HTTP API (verification mod calls this)

- `MOD_API_PORT` (local). On Railway/Render, `PORT` is used automatically.
- `MOD_API_SECRET`. Random 32+ char string. Must match the mod's `apiSecret`.

### Server addresses (shown in DMs / kick messages)

- `VERIFY_SERVER_ADDRESS`, `MAIN_SERVER_ADDRESS`
- `BEDROCK_FRIEND_NAME` (MCXboxBroadcast gamertag; optional)

### Channels (set the ones you'll use; leave others blank)

- `VERIFY_CHANNEL_ID`: verification panel
- `SPONSOR_CHANNEL_ID`: trusted-only sponsor panel
- `REQUEST_SPONSOR_CHANNEL_ID`: public "request a sponsor" panel
- `SPONSOR_REQUESTS_CHANNEL_ID`: admin-only request review channel
- `BOUNTY_CHANNEL_ID`: bounty board (active bounties posted here)
- `ADMIN_PANEL_CHANNEL_ID`: admin panel home
- `ADMIN_LOG_CHANNEL_ID`: automod + audit logs
- `MODMAIL_CHANNEL_ID`: DMs/mentions get forwarded here as threads

### Roles

- `ADMIN_ROLE_ID`, `TRUSTED_ROLE_ID`, `SPONSEE_ROLE_ID`,
  `VERIFIED_ROLE_ID`, `BOUNTY_ROLE_ID`

### LuckPerms group names

- `LP_SPONSEE_GROUP=sponsee`, `LP_TRUSTED_GROUP=trusted`

### RCON (optional)

Kept for compatibility, but the bot prefers in-game commands.

- `RCON_HOST`, `RCON_PORT`, `RCON_PASSWORD`

---

## Discord application setup

1. **Create the application + bot user** at the developer portal.
2. **Privileged Gateway Intents** (Bot tab). Enable all three:
   - **PRESENCE INTENT**: not strictly required, but nice to have
   - **SERVER MEMBERS INTENT**: required for welcome/goodbye and accurate role checks
   - **MESSAGE CONTENT INTENT**: required for modmail, automod, chat bridge
3. **Turn off "Public Bot"** so only you can generate an invite. The
   in-process allow-list backs this up, but it's the cleanest first line of
   defense.
4. **OAuth2 → URL Generator**. Scopes: `bot` + `applications.commands`.
   Permissions (minimum):
   - Manage Roles
   - Manage Channels
   - Manage Nicknames
   - Manage Threads
   - Manage Messages (automod deletes)
   - Moderate Members (automod timeouts)
   - Send Messages, Embed Links, Attach Files, Add Reactions, Use External Emojis
5. **Invite the bot** to your guild with the generated URL.
6. **Role hierarchy**: drag the bot's role above every role it will manage
   (Trusted, Sponsee, Verified, any reaction-role targets).

---

## Slash commands

Run `npm run register` after any change to `src/commands/*` to publish.

### User-facing
| Command | What it does |
|---|---|
| `/link` | Generates a 6-digit code and DMs you join instructions |
| `/unlink` | Removes your MC link |
| `/online` | Shows who's currently in-game |
| `/info user` / `avatar` / `server` | Quick info lookups |
| `/fun coinflip` / `dice` / `8ball` | Random fun |
| `/poll` | Quick multi-option poll with live tallies |

### Setup (admin-only)
| Command | Posts |
|---|---|
| `/verify-setup` | The verification panel ("Link Account" button) |
| `/sponsor-setup` | The trusted-only sponsor panel |
| `/request-sponsor-setup` | Public request-a-sponsor panel |
| `/bounty-setup` | Bounty board panel |
| `/ticket-setup` | Tickets panel |
| `/admin-setup` | Admin panel home |

### Admin
| Command | What it does |
|---|---|
| `/admin-user-status` | Force a user's status (none/linked/sponsee/trusted/banned) |
| `/admin-user-info` | View a user's full record |
| `/admin-user-force-sponsor` / `force-unsponsor` / `force-promote` | Override sponsorship state |
| `/admin-user-force-unlink` | Wipe a user's MC link |
| `/admin-user-clear-cooldowns` | Clear sponsor / link / request cooldowns |
| `/admin-user-reset-strikes` | Zero out a user's strike count |
| `/admin-user-dm` | DM a user as the bot |
| `/admin-sponsor-punish` | Apply a minor or major strike |
| `/admin-config-list` / `get` / `set` / `reset` | Manage runtime settings |
| `/admin-trigger-task` | Force-run a background task (expiry/decay/promotion/bounty-expiry/giveaway-draw) |
| `/admin-refresh-panels` | Re-post every persistent panel |
| `/admin-maintenance` | Toggle maintenance mode |
| `/admin-system-info` | Live system status embed |
| `/admin-audit-log` / `settings-audit` | Action history |
| `/admin-sync-nicknames` | Sync everyone's Discord nickname to their MC name |
| `/admin-clear-unlink-cooldown` | Targeted cooldown clear |
| `/bounty-blocklist add` / `remove` / `list` | Bar a user from being bountied |
| `/block` / `/unblock` / `/blocklist` | Block users from interacting with the bot |
| `/giveaway create` / `end` / `reroll` / `cancel` | Manage giveaways |
| `/reaction-roles` | Post a self-assign role panel with toggle buttons |
| `/say mc` / `say discord` | Speak as the bot |

---

## Background tasks

The scheduler runs these on intervals (configurable in
`src/systems/tasks/index.js`):

| Task | Default cadence | What it does |
|---|---|---|
| `expiry` | 5 min | Expires pending sponsor requests past their TTL |
| `decay` | 1 hour | Decays one strike per `strike_decay_days` of clean behaviour |
| `promotion` | 1 hour | Auto-promotes sponsees to Trusted after `auto_promote_days` clean |
| `bounty-expiry` | 1 min | Expires active bounties + reaps stale deposit sessions |
| `giveaway-draw` | 30 sec | Draws winners on giveaways whose `ends_at` has passed |

Run any task on demand via `/admin-trigger-task` or the Operations
subpanel.

---

## Runtime settings

Every tunable lives in the `settings` Postgres table and is editable from
the admin panel or via `/admin-config-set`. Categories include:

- **linking**: code TTL, unlink cooldown, verified-role toggle
- **sponsor**: capacity, auto-promote window, removal cooldown
- **strikes**: minor/major weights, thresholds, decay, suspension length
- **request**: expiry, cooldown, reason length bounds
- **bounty**: duration default, target cooldown, allowed items, deposit timeout, distance
- **automod**: slur list, invite block, trusted domains, spam thresholds, timeout
- **welcomer**: toggle, channel, message templates
- **bridge**: toggle, channel
- **tickets**: channel
- **system**: maintenance mode, persona name, status text, allow-self-unlink

See [`src/systems/settings/defaults.js`](src/systems/settings/defaults.js)
for the full list with descriptions.

---

## Deployment

### Railway (recommended)

1. Push this repo to GitHub. Private is fine. Verify `.env` is in
   `.gitignore` before pushing.
2. New Railway project → **Deploy from GitHub repo** → pick this one.
3. **Variables tab**: paste your `.env`. Omit `MOD_API_PORT` because Railway sets `PORT`.
4. **Settings → Networking → Generate Domain**. Copy the URL.
5. Update the verification mod's `botApiUrl` to that domain and restart
   the verification MC server.
6. First boot will request Microsoft device-code auth for the in-game bot.
   Open the URL printed in the Railway logs and complete the flow once.
   Consider mounting a Volume so the token cache persists across redeploys.

### Render

Use a **Web Service** (not Background Worker) so the HTTP API gets a
public URL. Same env-var setup. `npm start` as the start command.

### Self-hosted

Any Node 22+ host. Make sure inbound traffic on `MOD_API_PORT` is
reachable by the verification MC server's host.

---

## Bedrock support

The verification server runs **Geyser** (Bedrock ↔ Java proxy) and
**Floodgate** (Bedrock account authentication). Bedrock accounts get a
deterministic UUID derived from their Xbox ID and Floodgate's `key.pem`.

For the UUID to stay stable across the verification server and the main
server, **both servers must share the same `config/floodgate/key.pem`**.
The verification-server README walks through this.

Bedrock usernames carry a leading `.` (e.g. `.PlayerName`). The bot stores
the full prefixed name in the DB but strips the `.` for display.

---

## Project layout

```
index.js                              entry point
migrations/                           SQL migrations in order
scripts/register-commands.js          publishes slash commands
verify-server/                        verification server setup notes
src/
  api/server.js                       HTTP endpoints the verify-mod calls
  automod/                            slur + link + spam moderation
  bot/client.js                       discord.js client + interaction router
  bridge/                             MC <-> Discord chat bridge
  commands/                           all slash commands
  db/                                 supabase client + queries
  mineflayer/
    bot.js                            mineflayer wrapper w/ reconnect
    commands.js                       validated command wrappers (give/tp/...)
    auto-heal.js                      keeps the bot alive via effects
  modmail/                            DM/mention forwarding
  panels/                             persistent button/modal panels
  rcon/                               legacy shim (proxies to mineflayer)
  systems/
    bounty/                           bounty lifecycle
    giveaways/                        giveaway lifecycle
    linking/                          link cascade
    settings/                         runtime-tunable settings
    sponsor/                          sponsor + strikes + canSponsor
    tasks/                            background-task scheduler
    users/                            admin user-facing actions
  utils/
    admin-gate.js                     requireAdmin / requireTrusted
    blocklist.js                      bot-level user block
    config.js                         env + tunable constants
    discord-nickname.js               nickname sync helpers
    guild-allowlist.js                anti-leech: leave foreign guilds
    logger.js                         tagged logger
    messages.js                       shared user-facing copy
  welcomer/                           welcome + goodbye announcer
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, style, and how to add
features. PRs welcome.

---

## License

[MIT](LICENSE).
