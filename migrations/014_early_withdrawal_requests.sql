ALTER TABLE deals
ADD COLUMN IF NOT EXISTS early_withdrawal_penalty_rate REAL NOT NULL DEFAULT 0.30;

CREATE TABLE IF NOT EXISTS early_withdrawal_requests (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  position_id TEXT,
  class_type TEXT CHECK (class_type IN ('Class A', 'Class B', 'Class C')),
  requested_capital_amount REAL NOT NULL DEFAULT 0,
  penalty_rate REAL NOT NULL DEFAULT 0,
  penalty_amount REAL NOT NULL DEFAULT 0,
  approved_payout_amount REAL,
  investor_notes TEXT,
  manager_notes TEXT,
  request_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    request_status IN ('pending', 'approved', 'rejected')
  ),
  payout_expected_on TEXT,
  requested_by_user_id TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (deal_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_early_withdrawal_requests_deal_id
  ON early_withdrawal_requests(deal_id, participant_id, request_status);
