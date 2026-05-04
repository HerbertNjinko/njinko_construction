ALTER TABLE email_notifications
ADD COLUMN IF NOT EXISTS cleared_at TEXT;

CREATE INDEX IF NOT EXISTS idx_email_notifications_user_visible
  ON email_notifications(user_id, cleared_at, created_at DESC);
