# Verification Server

A dedicated Fabric Minecraft server used for **Discord ↔ MC account linking
only**. Players join here first, type a 6-digit code in chat, and are
immediately kicked back to the main server's address. They never see
anything meaningful — a tiny void world is all that's generated.

The verification server runs:
- Fabric Loader + Fabric API
- **Geyser** — accepts Bedrock connections, translates them to Java
- **Floodgate** — authenticates Bedrock accounts via Xbox Live
- **`verify-mod`** — the small Fabric mod that exposes `/verify <code>` and
  POSTs the code to the bot's HTTP API

> **Important grammar note for self:** in code and env vars we still use
> `VERIFY_SERVER_*` for historical reasons. In user-facing copy, prefer
> "verification server".

---

## Host requirements

The verification server is intentionally minimal:

| Resource | Sized for |
|---|---|
| RAM | 2 GB is plenty (idle players in a 5×5 void) |
| Disk | < 200 MB once the world generates |
| CPU | Almost nothing — no chunks tick |
| Players | A handful at a time; nobody stays more than ~30 seconds |

Any Fabric-capable host works (Pterodactyl, BisectHosting, Aternos, your
own VPS).

---

## Building the `verify-mod`

The mod lives in a **sibling project** at `verify-mod/` (one directory up
from this repo). Build steps:

```bash
cd ../verify-mod                          # path may vary
gradle wrapper                            # one-time, needs a system Gradle 8.x install
./gradlew build                           # produces build/libs/verify-mod-<ver>.jar
```

If Gradle isn't installed:
- **SDKMAN** (Linux/macOS/WSL): `sdk install gradle 8.10`
- **Windows / direct**: download from
  [gradle.org/install](https://gradle.org/install/) and add to `PATH`

You also need **JDK 21**. Set `JAVA_HOME` if you have multiple JDKs.

After a successful build, the output jar is at:

```
verify-mod/build/libs/verify-mod-1.0.0.jar
```

---

## Installing on the verification server

Drop these jars into `mods/`:

| Jar | Source |
|---|---|
| `fabric-api-<version>.jar` | [fabricmc.net](https://fabricmc.net/use/installer/) |
| `geyser-fabric.jar` | [geysermc.org](https://geysermc.org/download) |
| `floodgate-fabric.jar` | [geysermc.org](https://geysermc.org/download) |
| `verify-mod-<version>.jar` | the build above |

Boot the server once so the mods generate their config folders, then stop
it.

---

## Floodgate key sync (critical)

Bedrock players are identified by a deterministic UUID derived from their
Xbox account ID **and** Floodgate's private key. If the verification server
and the main server use different keys, the same Bedrock player generates
two different UUIDs and the link doesn't carry over.

To synchronise:

1. Boot the **main server** first so Floodgate generates its key.
2. Stop the **verification server** (if running).
3. Copy `config/floodgate/key.pem` *from the main server* into
   `config/floodgate/key.pem` on the verification server, overwriting
   whatever Floodgate generated there.
4. Start the verification server.

You can confirm with `/floodgate fingerprint` (or whatever the equivalent
command is for the Fabric port) — both servers should report the same
fingerprint.

---

## World generation

The included [`server.properties`](server.properties) configures a flat
void world: one layer of bedrock at `y=0`, void biome above it.

```
level-type=minecraft\:flat
generator-settings={"layers":[{"block":"minecraft:bedrock","height":1}],"biome":"minecraft:the_void"}
```

### First boot

1. **Delete the existing `world/` folder** if you've previously launched
   the server with different settings — Minecraft caches the generated
   world and won't regenerate just because `generator-settings` changed.
2. Start the server. A flat void world generates.
3. Op yourself from the console, join in-game, and run these once to lock
   the spawn:

   ```
   /worldborder center 0 0
   /worldborder set 50
   /setworldspawn 0 2 0
   /gamerule doImmediateRespawn true
   /gamerule doDaylightCycle false
   /gamerule doWeatherCycle false
   /time set day
   ```

4. (Optional) place a small bedrock platform around `0,1,0` so spawning
   players have a floor. The bedrock layer at `y=0` already exists, but
   spawn is set to `y=2` to give them headroom.

### Fallback if `generator-settings` is rejected

Mojang occasionally changes the JSON format between versions. If your
Minecraft version rejects the inline JSON above (look for a warning in the
server log, ending with a default flat plains world), use one of:

- A void-world datapack (registers a `the_void` preset).
- Just accept the default flat world. Adventure mode + spawn protection +
  the worldborder still prevents players from doing anything — they're
  only here for ~30 seconds.

---

## `verify-mod` configuration

After the mod's first boot, edit `config/verify-mod.json`:

```json
{
  "mode": "verify_server",
  "botApiUrl": "https://your-bot.up.railway.app",
  "apiSecret": "must match MOD_API_SECRET in the bot's .env",
  "mainServerAddress": "play.example.com:25565"
}
```

- **`botApiUrl`** — public address of the bot's HTTP API. On Railway it's
  the auto-generated domain. For local development you can use a tunnel
  like ngrok or cloudflared.
- **`apiSecret`** — random string, ≥ 32 chars. Must match `MOD_API_SECRET`
  in the bot's `.env`. The bot rejects POSTs without a matching secret.
- **`mainServerAddress`** — shown to the user on successful verification.

The mod POSTs to the bot's HTTP API directly. No RCON, no whispers, no
codes ever appear in public chat.

---

## `server.properties` checklist

The template here:

- `online-mode=false` — required by Floodgate (Floodgate handles auth for
  both Java and Bedrock connections before they reach vanilla server code).
- `white-list=false` — the verification server is open by design. The
  **main server** stays whitelisted; only sponsored players land on it.
- Flat void world + adventure mode + tight view distance + peaceful — the
  player has no reason to do anything other than type the code.

---

## Bot-side environment variables

Reference, for what the bot needs to know about your verification server:

```env
VERIFY_SERVER_ADDRESS=verify.example.com:25565   # shown in DMs
MAIN_SERVER_ADDRESS=play.example.com:25565       # shown post-link
MOD_API_PORT=3001                                # local; on Railway PORT is auto-set
MOD_API_SECRET=<random 32+ char string>          # must equal verify-mod's apiSecret
VERIFY_CHANNEL_ID=<id of #verify in your guild>
```

---

## Test flow

End-to-end smoke test:

1. In Discord, click **Link Account** in `#verify` (or run `/link`).
2. Note the 6-digit code from the ephemeral reply or DM.
3. Join the verification server.
4. Run `/verify 482910` in chat — or just type `482910` (Bedrock-friendly
   fallback that the mod also accepts).
5. The mod confirms in green, the bot kicks you with a "Discord linked"
   message, and you receive a DM telling you to request a sponsor.
6. Confirm in Supabase: the `users` row for your Discord ID now has
   `status = 'linked'` and the correct `mc_uuid` / `mc_name`.
