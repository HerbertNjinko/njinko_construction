ALTER TABLE participants
DROP CONSTRAINT IF EXISTS participants_category_check;

ALTER TABLE participants
ADD CONSTRAINT participants_category_check CHECK (
  category IN ('sponsor', 'investor', 'contractor', 'manager', 'pool_member', 'pool')
);

CREATE TABLE IF NOT EXISTS investor_pools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  pool_participant_id TEXT NOT NULL UNIQUE,
  minimum_capital_amount REAL NOT NULL CHECK (minimum_capital_amount > 0),
  status TEXT NOT NULL CHECK (status IN ('open', 'voting', 'funded')),
  vote_closes_on TEXT,
  selected_deal_id TEXT,
  funded_on TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (pool_participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (selected_deal_id) REFERENCES deals(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS investor_pool_commitments (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  commitment_amount REAL NOT NULL CHECK (commitment_amount > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (pool_id) REFERENCES investor_pools(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  UNIQUE (pool_id, participant_id)
);

CREATE TABLE IF NOT EXISTS investor_pool_votes (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (pool_id) REFERENCES investor_pools(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  UNIQUE (pool_id, participant_id)
);
