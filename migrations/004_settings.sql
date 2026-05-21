-- 004 - runtime-tunable settings + audit log.
-- Values are JSON-encoded (so `JSON.parse` round-trips them); `type` is a hint
-- for validation + the admin panel UI.

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('int', 'float', 'bool', 'string')),
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings_audit (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT NOT NULL,
  changed_by  TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS settings_audit_key_idx        ON settings_audit (key);
CREATE INDEX IF NOT EXISTS settings_audit_changed_at_idx ON settings_audit (changed_at DESC);
