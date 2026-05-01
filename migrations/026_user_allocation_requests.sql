CREATE TABLE IF NOT EXISTS user_allocation_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  participant_category TEXT NOT NULL CHECK (
    participant_category IN ('investor', 'pool_member', 'contractor')
  ),
  amount REAL NOT NULL CHECK (amount > 0),
  class_type TEXT NOT NULL CHECK (class_type IN ('Class A', 'Class B', 'Class C')),
  contribution_type TEXT NOT NULL,
  trade TEXT,
  participant_notes TEXT,
  manager_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_position_id TEXT,
  submitted_at TEXT NOT NULL,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  FOREIGN KEY (created_position_id) REFERENCES positions(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_allocation_requests_participant_id
  ON user_allocation_requests(participant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_allocation_requests_deal_id
  ON user_allocation_requests(deal_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_allocation_requests_status
  ON user_allocation_requests(status, created_at DESC);
