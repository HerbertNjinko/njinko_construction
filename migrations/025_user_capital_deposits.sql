CREATE TABLE IF NOT EXISTS user_capital_deposits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  proof_file_name TEXT,
  proof_file_mime_type TEXT,
  proof_file_data_url TEXT,
  notes TEXT,
  manager_notes TEXT,
  submitted_by_user_id TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_capital_deposits_user_id
  ON user_capital_deposits(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_capital_deposits_participant_id
  ON user_capital_deposits(participant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_capital_deposits_status
  ON user_capital_deposits(status, created_at DESC);
