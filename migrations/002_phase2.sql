-- Phase 2 migration: prerequisites for the verify server, sponsor system, and
-- request-a-sponsor system. Idempotent - safe to re-run.

-- 1) Expand the status enum to add 'linked' (between 'none' and 'sponsee').
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('none', 'linked', 'sponsee', 'trusted', 'banned'));

-- One-time backfill: anyone with an MC link but still on default 'none'
-- becomes 'linked'. Trusted/sponsee/banned rows are left alone.
UPDATE users SET status = 'linked'
  WHERE status = 'none' AND mc_uuid IS NOT NULL;

-- 2) New columns on users for sponsor cooldowns / request cooldown.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS next_sponsor_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_request_ended_at  TIMESTAMPTZ;

-- 3) Sponsor requests. The column "references" would collide with the SQL
-- reserved word, so we rename it to applicant_references. The application
-- code treats this as the "references" field in spec terms.
CREATE TABLE IF NOT EXISTS sponsor_requests (
  id                       SERIAL PRIMARY KEY,
  requester_discord_id     TEXT REFERENCES users(discord_id),
  reason                   TEXT,
  applicant_references     TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','sponsored','rejected','expired')),
  message_id               TEXT,
  responded_by_discord_id  TEXT REFERENCES users(discord_id),
  responded_at             TIMESTAMPTZ,
  rejection_reason         TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sponsor_requests_status_idx     ON sponsor_requests (status);
CREATE INDEX IF NOT EXISTS sponsor_requests_requester_idx  ON sponsor_requests (requester_discord_id);
CREATE INDEX IF NOT EXISTS sponsor_requests_expires_idx    ON sponsor_requests (expires_at);

-- sponsor_logs already created by 001_init.sql - no changes needed in this phase.
