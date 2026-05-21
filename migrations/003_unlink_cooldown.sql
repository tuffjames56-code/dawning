-- 003 - 24h re-link cooldown after self-unlink. Set by the cascade-unlink
-- flow in /unlink; checked by /link and the verify panel before issuing a code.
-- Cleared by /admin-clear-unlink-cooldown.

ALTER TABLE users ADD COLUMN IF NOT EXISTS next_link_at TIMESTAMPTZ;
