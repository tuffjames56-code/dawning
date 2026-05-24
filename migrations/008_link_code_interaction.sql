-- Stores the interaction token + application id of the ephemeral message
-- that delivered each link code. After successful /verify the bot uses the
-- Discord webhook API to edit that original ephemeral so the user sees
-- "✓ Linked" instead of the stale code instructions.

ALTER TABLE link_codes
  ADD COLUMN IF NOT EXISTS interaction_token TEXT,
  ADD COLUMN IF NOT EXISTS application_id    TEXT;
