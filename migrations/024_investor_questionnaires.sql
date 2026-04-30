CREATE TABLE IF NOT EXISTS investor_questionnaires (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  participant_id TEXT NOT NULL,
  name_entity TEXT NOT NULL,
  address TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  income_over_200k INTEGER NOT NULL DEFAULT 0 CHECK (income_over_200k IN (0, 1)),
  net_worth_over_100k INTEGER NOT NULL DEFAULT 0 CHECK (net_worth_over_100k IN (0, 1)),
  entity_over_5m_assets INTEGER NOT NULL DEFAULT 0 CHECK (entity_over_5m_assets IN (0, 1)),
  investment_experience TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_investor_questionnaires_participant_id
  ON investor_questionnaires(participant_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_investor_questionnaires_submitted_at
  ON investor_questionnaires(submitted_at DESC);
