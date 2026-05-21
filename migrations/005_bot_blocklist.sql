-- Bot blocklist: Discord users blocked from interacting with the bot.
-- Distinct from users.status='banned' (which bans them from the MC server).
-- A blocked user's slash commands, button clicks, DMs, and @-mentions are
-- silently ignored by the bot.

CREATE TABLE IF NOT EXISTS bot_blocklist (
  discord_id  TEXT PRIMARY KEY,
  blocked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_by  TEXT,
  reason      TEXT
);
