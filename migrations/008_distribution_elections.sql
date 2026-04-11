CREATE TABLE IF NOT EXISTS distribution_elections (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  election_mode TEXT NOT NULL CHECK (
    election_mode IN ('payout_all', 'reinvest_all', 'split_percentage', 'split_amount')
  ),
  reinvest_percent REAL,
  reinvest_amount REAL,
  rollover_target_deal_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (rollover_target_deal_id) REFERENCES deals(id) ON DELETE SET NULL,
  UNIQUE (deal_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_distribution_elections_deal_id
  ON distribution_elections(deal_id, participant_id);
