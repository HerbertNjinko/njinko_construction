ALTER TABLE deals
ADD COLUMN IF NOT EXISTS pooled_vote_threshold REAL NOT NULL DEFAULT 0.50 CHECK (
  pooled_vote_threshold > 0
  AND pooled_vote_threshold <= 1
);

ALTER TABLE deals
ADD COLUMN IF NOT EXISTS pooled_vote_closes_on TEXT;

UPDATE deals
SET pooled_vote_closes_on = COALESCE(pooled_vote_closes_on, investment_close_on)
WHERE pooled_vote_closes_on IS NULL;

CREATE TABLE IF NOT EXISTS project_pool_votes (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  vote_choice TEXT NOT NULL CHECK (vote_choice IN ('yes', 'no')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  UNIQUE (deal_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_project_pool_votes_deal_id
  ON project_pool_votes(deal_id, updated_at DESC);
