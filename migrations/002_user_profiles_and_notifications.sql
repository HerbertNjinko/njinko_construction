ALTER TABLE participants
  DROP CONSTRAINT IF EXISTS participants_category_check;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS middle_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS driver_license_number TEXT,
  ADD COLUMN IF NOT EXISTS id_card_file_name TEXT,
  ADD COLUMN IF NOT EXISTS id_card_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS id_card_data_url TEXT,
  ADD COLUMN IF NOT EXISTS current_address TEXT,
  ADD COLUMN IF NOT EXISTS mailing_address TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS payout_method TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_routing_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS zelle_details TEXT,
  ADD COLUMN IF NOT EXISTS cash_app_handle TEXT,
  ADD COLUMN IF NOT EXISTS payout_notes TEXT;

ALTER TABLE participants
  ADD CONSTRAINT participants_category_check
  CHECK (category IN ('sponsor', 'investor', 'contractor', 'manager'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_login_at TEXT;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_must_change_password_check;

ALTER TABLE users
  ADD CONSTRAINT users_must_change_password_check
  CHECK (must_change_password IN (0, 1));

CREATE TABLE IF NOT EXISTS email_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'saved_local', 'failed')),
  provider TEXT NOT NULL,
  local_path TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_notifications_user_id
  ON email_notifications(user_id, created_at DESC);
