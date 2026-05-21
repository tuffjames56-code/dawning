-- Phase 1 schema: users + link_codes are the only tables the linking system needs.
-- The sponsor/bounty tables are included here so a single migration sets up the
-- whole project; they are not yet referenced from code.

-- Users + link state
CREATE TABLE IF NOT EXISTS users (
  discord_id            TEXT PRIMARY KEY,
  mc_uuid               TEXT UNIQUE,
  mc_name               TEXT,
  status                TEXT NOT NULL DEFAULT 'none'
                          CHECK (status IN ('none','trusted','sponsee','banned')),
  sponsor_discord_id    TEXT REFERENCES users(discord_id),
  sponsored_at          TIMESTAMPTZ,
  strikes               INT NOT NULL DEFAULT 0,
  last_strike_decay_at  TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_mc_uuid_idx     ON users (mc_uuid);
CREATE INDEX IF NOT EXISTS users_sponsor_idx     ON users (sponsor_discord_id);
CREATE INDEX IF NOT EXISTS users_status_idx      ON users (status);

CREATE TABLE IF NOT EXISTS link_codes (
  code        TEXT PRIMARY KEY,
  discord_id  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS link_codes_discord_idx ON link_codes (discord_id);

-- Bounties
CREATE TABLE IF NOT EXISTS bounties (
  id                       SERIAL PRIMARY KEY,
  poster_discord_id        TEXT REFERENCES users(discord_id),
  target_discord_id        TEXT REFERENCES users(discord_id),
  target_mc_name           TEXT,
  expires_at               TIMESTAMPTZ,
  status                   TEXT NOT NULL DEFAULT 'depositing'
                              CHECK (status IN ('depositing','active','completed','expired','cancelled')),
  claimed_by_discord_id    TEXT REFERENCES users(discord_id),
  claimed_at               TIMESTAMPTZ,
  message_id               TEXT,
  posted_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS bounties_status_idx     ON bounties (status);
CREATE INDEX IF NOT EXISTS bounties_target_idx     ON bounties (target_discord_id);
CREATE INDEX IF NOT EXISTS bounties_poster_idx     ON bounties (poster_discord_id);
CREATE INDEX IF NOT EXISTS bounties_expires_idx    ON bounties (expires_at);

CREATE TABLE IF NOT EXISTS bounty_items (
  id           SERIAL PRIMARY KEY,
  bounty_id    INT NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  item_id      TEXT,
  item_name    TEXT,
  count        INT,
  nbt          TEXT
);

CREATE INDEX IF NOT EXISTS bounty_items_bounty_idx ON bounty_items (bounty_id);

CREATE TABLE IF NOT EXISTS bounty_cooldowns (
  target_discord_id  TEXT PRIMARY KEY REFERENCES users(discord_id),
  last_bountied_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS deposit_sessions (
  id                  SERIAL PRIMARY KEY,
  user_discord_id     TEXT REFERENCES users(discord_id),
  user_mc_name        TEXT,
  pending_bounty_id   INT REFERENCES bounties(id),
  status              TEXT NOT NULL DEFAULT 'awaiting_tpa'
                        CHECK (status IN ('awaiting_tpa','awaiting_items','complete','cancelled')),
  saved_x             DOUBLE PRECISION,
  saved_y             DOUBLE PRECISION,
  saved_z             DOUBLE PRECISION,
  saved_dimension     TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS deposit_sessions_user_idx   ON deposit_sessions (user_discord_id);
CREATE INDEX IF NOT EXISTS deposit_sessions_status_idx ON deposit_sessions (status);

-- Sponsor action history
CREATE TABLE IF NOT EXISTS sponsor_logs (
  id                    SERIAL PRIMARY KEY,
  sponsor_discord_id    TEXT,
  sponsee_discord_id    TEXT,
  action                TEXT,  -- 'sponsored','removed','punished','auto_trusted'
  severity              TEXT,  -- 'minor','major','none'
  strike_delta          INT,
  notes                 TEXT,
  timestamp             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sponsor_logs_sponsor_idx ON sponsor_logs (sponsor_discord_id);
CREATE INDEX IF NOT EXISTS sponsor_logs_sponsee_idx ON sponsor_logs (sponsee_discord_id);

-- Optional: a blocklist for bounty targets (referenced by /bounty-blocklist).
CREATE TABLE IF NOT EXISTS bounty_blocklist (
  discord_id  TEXT PRIMARY KEY,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by    TEXT,
  reason      TEXT
);
