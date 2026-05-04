CREATE TABLE IF NOT EXISTS user_account_payouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  deal_id TEXT,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('unallocated_funds', 'early_withdrawal', 'distribution_cash')
  ),
  source_id TEXT,
  amount REAL NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'paid', 'failed', 'cancelled')
  ),
  provider_name TEXT,
  provider_transfer_id TEXT,
  provider_transfer_url TEXT,
  provider_transfer_status TEXT,
  provider_correlation_id TEXT,
  provider_failure_reason TEXT,
  provider_raw_event JSONB,
  notes TEXT,
  manager_notes TEXT,
  requested_by_user_id TEXT,
  approved_by_user_id TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_account_payouts_user_id
  ON user_account_payouts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_account_payouts_participant_id
  ON user_account_payouts(participant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_account_payouts_status
  ON user_account_payouts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_account_payouts_provider_transfer
  ON user_account_payouts(provider_name, provider_transfer_id);

CREATE INDEX IF NOT EXISTS idx_user_account_payouts_source
  ON user_account_payouts(source_type, source_id);
