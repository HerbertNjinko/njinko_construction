ALTER TABLE email_notifications
ADD COLUMN IF NOT EXISTS read_at TEXT;

CREATE INDEX IF NOT EXISTS idx_email_notifications_user_unread
  ON email_notifications(user_id, read_at, created_at DESC);
