ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS id_document_issue_date TEXT,
  ADD COLUMN IF NOT EXISTS id_document_expiration_date TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS account_rejection_comment TEXT,
  ADD COLUMN IF NOT EXISTS account_reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_reviewed_at TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_submitted_at TEXT;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_approval_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_account_approval_status_check
  CHECK (account_approval_status IN ('profile_required', 'pending_review', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_users_account_approval_status
  ON users(account_approval_status);
