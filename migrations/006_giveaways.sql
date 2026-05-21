-- Giveaways: timed prize draws inside a Discord channel. Users enter via a
-- button on the giveaway embed; the scheduler picks winners at expiry.

CREATE TABLE IF NOT EXISTS giveaways (
  id              SERIAL PRIMARY KEY,
  channel_id      TEXT NOT NULL,
  message_id      TEXT,
  host_discord_id TEXT,
  prize           TEXT NOT NULL,
  winners_count   INT  NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'ended', 'cancelled')),
  ends_at         TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  winner_ids      TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS giveaways_status_idx  ON giveaways (status);
CREATE INDEX IF NOT EXISTS giveaways_ends_at_idx ON giveaways (ends_at);

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  discord_id  TEXT NOT NULL,
  entered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (giveaway_id, discord_id)
);
