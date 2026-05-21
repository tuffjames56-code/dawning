# Contributing

Thanks for your interest in improving this bot. The project is intentionally
small and opinionated, but useful contributions are welcome.

## Before you start

- **Open an issue first** for anything non-trivial (new feature, schema
  change, dependency bump). It avoids you doing work that gets rejected for
  scope reasons.
- For typos, doc fixes, or one-line bug fixes — just send the PR.

## Development setup

```bash
git clone <your fork>
cd <repo>
npm install
cp .env.example .env       # then fill it in
# Set up a Supabase project, run every file in migrations/ in order.
npm run register           # publishes slash commands to your test guild
npm start                  # boots the bot
```

You need **Node 22+** (Supabase's realtime client requires native `WebSocket`).
Java 21 is only needed if you're touching the sibling `verify-mod` project.

## Code style

- ES modules everywhere (`type: "module"` in package.json).
- Single-quote strings, two-space indent. No semicolons-omitted style.
- Each file has a short header comment explaining what it owns.
- Logging is done via `logger.child('tag')` — never `console.log` outside
  of `scripts/`.
- Database access goes through `src/db/queries.js`. Don't sprinkle Supabase
  calls across feature modules.
- All server-side MC commands flow through `src/mineflayer/commands.js`'s
  validated wrappers (`mcGive`, `mcTeleport`, etc.). Don't shell out to
  RCON or call `bot.chat('/...')` directly from feature code.
- Settings live in `src/systems/settings/defaults.js`. To add one,
  `registerSetting(...)` once and use `getSetting('key')` anywhere.
- Match Discord component custom-id convention: `panel:action[:arg...]`.

## Adding a feature

A typical feature touches three places:

1. **Slash command** in `src/commands/<name>.js` — exports `data` (a
   `SlashCommandBuilder`) and `execute(interaction)`. Add the file to
   `src/commands/index.js`.
2. **Panel module(s)** in `src/panels/<name>.js` for any persistent
   button/modal/select. Register handlers via the registry maps imported
   from `./registry.js`. Add to `src/panels/index.js`.
3. **Domain logic** in `src/systems/<area>/`. Keep this layer free of
   discord.js — it should be testable in isolation.

If your feature requires runtime tuning, add settings rather than env vars.

## Migrations

Add a new file in `migrations/` numbered after the last one (`007_…sql`,
`008_…sql`). Migrations must be:

- Idempotent (safe to re-run)
- Pure SQL — no surrounding shell scripting
- Self-documenting in a header comment

Don't edit old migration files. If you need to alter an existing table,
add a new migration.

## Background tasks

If your feature needs a periodic sweep, add it to
`src/systems/tasks/index.js`'s dispatch table:

```js
export const TASKS = {
  ...,
  'your-task': { fn: runYourTask, intervalMs: 60_000 },
};
```

Then add the task name to `/admin-trigger-task`'s `addChoices` so admins
can force-run it.

## Testing your changes

There's no automated test suite yet — manual testing for now.

For most features, the smoke test loop is:

1. `npm start`
2. Trigger your feature in Discord
3. Check the bot log for warnings / errors
4. Verify the DB / MC server state matches expectations

If you're adding tests, **please do** — `vitest` is a reasonable choice
since the codebase is ESM.

## Commit hygiene

- One logical change per PR. Squash unrelated commits.
- Commit messages: imperative mood, short summary first line, optional
  body for context.
- Reference the issue you're fixing (`fixes #42`) in the PR description.

## Security

Found a security issue? **Don't open a public issue.** DM the maintainer
on Discord or email them. Reasonable response time: 72 hours.

The most sensitive surfaces are:

- The HTTP API (`src/api/server.js`) — anything that POSTs without the
  shared secret should be rejected
- The validated command wrappers (`src/mineflayer/commands.js`) — if any
  user-supplied input ever reaches `sendCommand` without going through a
  wrapper, that's a vulnerability
- The blocklist + automod — bypasses or false-positive denial-of-service

## Out of scope

This bot is built for one specific community shape: a small-to-medium
modded MC server with sponsor + bounty rituals. PRs that pull it toward a
generic moderation bot, a music bot, or a corporate community bot are
unlikely to be accepted.

## License

By contributing, you agree your contributions are licensed under the same
terms as the project (see [LICENSE](LICENSE)).
