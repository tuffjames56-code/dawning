# Verify Server

A dedicated Fabric MC server for Discord linking. Players join here first
to link their account, then move to the main server once a trusted member
sponsors them.

## Pterodactyl setup

1. Create a new Fabric server allocation. MC 26.1.2, Fabric Loader 0.19.2+.
2. Set a memory allocation of 2GB or less — this server holds 5x5 of flat
   void with idle players sitting in spawn. It does almost nothing.
3. Open the public allocation port and note it as `VERIFY_SERVER_ADDRESS`
   in the bot's `.env`. Bedrock players use the same address + UDP port
   (Geyser default 19132).

## Mods

Drop into `mods/`:
- **Fabric API**
- **fabric-language-kotlin** (only if any mod below needs it)
- **Geyser-Fabric** — accepts Bedrock connections, translates them to Java
- **Floodgate** — handles Bedrock authentication via Xbox Live
- **verify-mod** (the sibling project, built with `./gradlew build`)

## Floodgate key sync (CRITICAL)

Bedrock players are identified by a deterministic UUID derived from their
Xbox ID and Floodgate's `key.pem`. If the main server and verify server use
different keys, the same Bedrock player gets two different UUIDs and the
link does not transfer.

After Floodgate generates its key on first launch of the verify server:
1. Stop the verify server.
2. Copy `config/floodgate/key.pem` **from the main server** into
   `config/floodgate/key.pem` on the verify server, overwriting whatever
   Floodgate generated.
3. Start the verify server. Both servers now produce identical UUIDs for
   the same Bedrock account.

Verify by running `/floodgate fingerprint` (or whatever Floodgate's status
command is in the Fabric port) and confirming the fingerprints match.

## World setup

The included [server.properties](server.properties) configures a void world
(one bedrock layer at y=0, otherwise air) via:

```
level-type=minecraft\:flat
generator-settings={"layers":[{"block":"minecraft:bedrock","height":1}],"biome":"minecraft:the_void"}
```

### First boot

1. **Delete the existing `world/` folder** if you previously launched the
   server with different settings — Minecraft caches the generated world
   and won't regenerate it just because `generator-settings` changed.
2. Start the server with the new properties. A flat void world will
   generate.
3. Op yourself in console and run, on the world's first boot:

   ```
   /worldborder center 0 0
   /worldborder set 50
   /setworldspawn 0 2 0
   /gamerule doImmediateRespawn true
   /gamerule doDaylightCycle false
   /gamerule doWeatherCycle false
   /time set day
   ```

4. **Optional:** place a 5x5 bedrock platform around spawn manually so
   players have somewhere to stand. (Adventure mode prevents them from
   breaking it.) The bedrock layer at y=0 is already there but spawn is
   set to y=2 to give them an air pocket above it.

### Fallback if generator-settings is rejected

Mojang occasionally changes the JSON format between versions. If 26.1.2
doesn't accept the inline JSON above (you'll see a warning in the server
log and end up with a default flat plains world), use one of:

- A void-world datapack (e.g. one that registers a `the_void` world preset).
- Just accept the default flat world. Adventure mode + spawn protection
  + worldborder still prevents players from doing anything meaningful —
  they're only on the server for ~30 seconds anyway.

## verify-mod config

After the mod is loaded, edit `config/verify-mod.json`:

```json
{
  "mode": "verify_server",
  "botApiUrl": "https://your-bot.railway.app",
  "apiSecret": "must match MOD_API_SECRET in the bot's .env",
  "mainServerAddress": "play.example.com:25565"
}
```

The mod posts directly to the bot's HTTP API for verification. No
RCON, no whisper round-trips, nothing leaks to public chat.

## server.properties

The repo includes a [server.properties](server.properties) template:
- `online-mode=false` — required by Floodgate (Floodgate handles auth
  for both Java and Bedrock clients before connections reach the server)
- `white-list=false` — this server is intentionally open; the main server
  stays whitelisted and only sponsored players get added
- Flat world, tight view distance, peaceful, adventure mode — players
  literally only need to type a code

## Bot-side env vars

In the bot's `.env`, set:
- `VERIFY_SERVER_ADDRESS=verify.example.com:25565`
- `MAIN_SERVER_ADDRESS=play.example.com:25565`
- `MOD_API_PORT=3001` (or whatever port the bot listens on)
- `MOD_API_SECRET=<random 32+ chars>` — must match the mod config
