ALTER TABLE distribution_elections
ADD COLUMN IF NOT EXISTS submitted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE distribution_elections
ADD COLUMN IF NOT EXISTS submitted_by_role TEXT
  CHECK (submitted_by_role IN ('investor', 'manager'));

ALTER TABLE distribution_elections
ADD COLUMN IF NOT EXISTS reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE distribution_elections
ADD COLUMN IF NOT EXISTS reviewed_at TEXT;

ALTER TABLE distribution_elections
ADD COLUMN IF NOT EXISTS manager_override INTEGER NOT NULL DEFAULT 0
  CHECK (manager_override IN (0, 1));

ALTER TABLE distribution_elections
ADD COLUMN IF NOT EXISTS override_notes TEXT;
