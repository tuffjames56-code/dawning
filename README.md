# Minecraft Sponsor & Bounty Bot

Discord bot for a modded Fabric 26.1.2 server. Runs a discord.js client and a
mineflayer in-game bot in the same Node process and talks to the server via
RCON for admin commands.

**Status:** Phase 2 in progress. Linking is being migrated to a dedicated **verify server** with HTTP-based mod ↔ bot communication and Bedrock support (Geyser + Floodgate). Sponsor + bounty systems still pending.

---

## Setup

### 1. Install
```
npm install
```

### 2. Configure
Copy `.env.example` to `.env` and fill in:
- A Discord application token + client ID + guild ID
- A Supabase project URL + service-role key
- Minecraft server host/port + an MS-authed bot account username (`MC_BOT_AUTH=microsoft`)
- RCON host/port/password (enable RCON in `server.properties` on your MC server)
- Discord channel + role IDs (not all required for phase 1)

### 3. Migrate the database
Open `migrations/001_init.sql` in the Supabase SQL editor and run it. This creates every table for all three phases.

### 4. Register slash commands
```
npm run register
```
Guild-scoped registration is instant. Re-run after editing any `src/commands/*.js`.

### 5. Run
```
npm start
```

---

## Phase 2: linking via verify server (HTTP)

Linking now runs on a separate **verify server** (Geyser + Floodgate, online-mode=false but auth-protected). The bot exposes a small HTTP API; the verify-mod POSTs codes directly. No chat, no whispers, no codes in public.

### Architecture

```
Discord user
  ├─ /link              (slash command)             ─┐
  └─ #verify panel      (Link Account button)        ├─ generates code + DMs/ephemeral reply
                                                     │
verify server (Fabric + Geyser + Floodgate + verify-mod)
  ├─ /verify 482910     (slash command, Java + Bedrock)
  └─ "482910" in chat   (Bedrock-friendly fallback)  ─→ POST /verify {mcUuid, mcName, code, sharedSecret}
                                                     │
bot (this repo)                                      │
  └─ HTTP API (:MOD_API_PORT) ────────────────────── ┘ validates secret → links → DMs user → kicks player
```

### Discord-side commands

| Command          | Who    | What                                                                 |
|------------------|--------|----------------------------------------------------------------------|
| `/link`          | anyone | Generates a 6-digit code and DMs you join instructions for the verify server. |
| `/unlink`        | anyone | Removes your Discord ↔ MC link.                                       |
| `/verify-setup`  | admin  | Posts the persistent **Link Account** button panel in this channel.  |

### Verify panel

Run `/verify-setup` in your `#verify` channel. Anyone clicking **Link Account** gets an ephemeral reply with their code + the verify server address + instructions. The button persists across bot restarts (no state needed).

### Discord Verified role (auto-assigned on link)

If you set `VERIFIED_ROLE_ID` in `.env`, the bot will:
- Add that role to the Discord user when their `/verify` succeeds.
- Remove that role when they run `/unlink`.

This role is **Discord-side only** — it gates which channels they can see. It does NOT affect MC server access (the `status` enum + whitelist do that).

For the bot to manage the role:
- The bot's Discord application needs the **Manage Roles** permission in your guild.
- In your server's role list, the bot's own role must sit **above** the Verified role (Discord role hierarchy rule — a role can only manage roles below it).

Existing linked users from before this feature won't have the role retroactively. Either ask them to `/unlink` then `/link` again, or assign the role manually.

### Setup checklist

1. **Run both migrations** in the Supabase SQL editor, in order:
   - `migrations/001_init.sql`
   - `migrations/002_phase2.sql` (idempotent — safe to re-run)
2. **Spin up the verify server**: see [`verify-server/README.md`](verify-server/README.md). Critical step: copy `config/floodgate/key.pem` from the main server to the verify server so Bedrock UUIDs match.
3. **Build + install verify-mod** on the verify server with `mode: "verify_server"` in `config/verify-mod.json`. (If you want the same mod on the main server for future features, set `mode: "main_server"` there.)
4. **Configure the bot's `.env`** (see `.env.example`). New required vars: `MOD_API_SECRET`, `VERIFY_SERVER_ADDRESS`, `MAIN_SERVER_ADDRESS`, `VERIFY_CHANNEL_ID`. `MOD_API_SECRET` must match `apiSecret` in the mod's config.
5. **Register commands** (`npm run register`) — picks up `/verify-setup`.
6. **Start the bot**: `npm start`. You should see "HTTP API listening on :3001" and a Discord login.
7. **Post the panel**: in `#verify`, run `/verify-setup`.

### Test the flow

1. In Discord, click **Link Account** in `#verify` (or run `/link`).
2. Note the code from the ephemeral reply or DM.
3. Join the verify server. You should see a welcome message; it repeats every 30s until you verify.
4. Run `/verify 482910` — or just type `482910` in chat (Bedrock-friendly path).
5. The mod whispers a green submission confirmation, the bot kicks you with "✓ Your Discord is now linked! ...", and you get a DM telling you to ask for a sponsor.
6. Check Supabase: `SELECT * FROM users WHERE discord_id = '...'` should show `status = 'linked'`.

### Status values (after phase 2 migration)

`none → linked → sponsee → trusted` (plus terminal `banned`). The migration backfills existing linked users from `none` to `linked` automatically.

### Bedrock notes

Floodgate prefixes Bedrock usernames with `.` (e.g. `.PlayerName`). The bot stores the full prefixed name in `users.mc_name` but strips the leading `.` for display in DMs and embeds. The UUID Floodgate derives from the Xbox account is the canonical identity.

---

## Deploying to Railway

- Add this repo as a Railway service.
- Set all env vars from `.env.example` in the Railway dashboard.
- Start command: `npm start`.
- After first deploy, run `npm run register` locally (or as a one-off Railway shell) to push slash commands.

---

## Open questions (carried forward to phases 2 + 3)

These were flagged in the original spec and remain unanswered:

1. **Death message format** on your modded server (covers bounty completion detection). Need at least one real example per cause (player kill, mob kill, environment).
2. **TPA mod command syntax.** Spec says SimpleTPA: `/tpa <player>` requests, `/tpaccept` accepts — confirm before bounty phase.
3. **Rare-items minimum** on bounties — disabled in v1 per spec, leaving it off.
4. **Non-linked killer claiming a bounty** — spec leans "they must link before payout"; will implement that.

---

## Layout
```
index.js                        entry point
migrations/
  001_init.sql                  initial all-phase schema
  002_phase2.sql                phase 2 additions (status='linked', sponsor_requests, etc.)
scripts/register-commands.js    pushes slash commands to Discord
verify-server/                  configs + setup notes for the dedicated verify MC server
src/
  api/server.js                 HTTP API the verify-mod POSTs to (/verify)
  bot/client.js                 discord.js client + interaction router (commands, buttons, modals)
  mineflayer/bot.js             mineflayer wrapper w/ reconnect + event re-emit
  commands/                     slash command definitions
    index.js                    registry
    link.js, unlink.js, verify-setup.js
  panels/                       persistent button/modal panels
    registry.js                 customId -> handler maps
    verify.js                   #verify-channel panel
  systems/linking/
    perform.js                  shared link operation (used by HTTP API)
    index.js                    no-op stub (whisper handler removed in phase 2)
  db/                           supabase client + query helpers
  rcon/client.js                lazy RCON client
  utils/
    config.js                   env + tunable constants (SPONSOR / BOUNTY)
    logger.js                   tiny tagged logger
    code.js                     6-digit code generator
```
