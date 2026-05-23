-- IP security: every linked user accumulates an approved-IP list. New IPs
-- are blocked at MC join time until the user explicitly approves via DM.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approved_ips  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pending_ip    TEXT,
  ADD COLUMN IF NOT EXISTS pending_ip_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_pending_ip_idx ON users (pending_ip) WHERE pending_ip IS NOT NULL;
