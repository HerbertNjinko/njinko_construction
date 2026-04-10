ALTER TABLE deals
ADD COLUMN IF NOT EXISTS debt_interest_rate REAL NOT NULL DEFAULT 0;

ALTER TABLE deals
ADD COLUMN IF NOT EXISTS total_interest_paid REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS deal_issues (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  approval_threshold REAL NOT NULL DEFAULT 0.75,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (approval_threshold > 0 AND approval_threshold <= 1)
);

CREATE TABLE IF NOT EXISTS deal_issue_votes (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  vote_choice TEXT NOT NULL CHECK (vote_choice IN ('yes', 'no')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES deal_issues(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  UNIQUE (issue_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_issues_deal_id ON deal_issues(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_issue_votes_issue_id ON deal_issue_votes(issue_id);
