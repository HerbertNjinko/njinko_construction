ALTER TABLE deals
ADD COLUMN IF NOT EXISTS distribution_election_due_on TEXT;

ALTER TABLE deals
ADD COLUMN IF NOT EXISTS distribution_election_notice_sent_at TEXT;

UPDATE deals
SET distribution_election_due_on = COALESCE(
  distribution_election_due_on,
  to_char(CURRENT_DATE + INTERVAL '14 day', 'YYYY-MM-DD')
)
WHERE status = 'sold';

CREATE INDEX IF NOT EXISTS idx_deals_distribution_election_due_on
  ON deals(status, distribution_election_due_on);
