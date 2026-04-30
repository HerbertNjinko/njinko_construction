CREATE TABLE IF NOT EXISTS user_legal_acknowledgements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  document_key TEXT NOT NULL,
  document_title TEXT NOT NULL,
  document_version TEXT NOT NULL,
  document_file_name TEXT,
  required_for_category TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  UNIQUE (user_id, document_key, document_version)
);

CREATE INDEX IF NOT EXISTS idx_user_legal_acknowledgements_user_id
  ON user_legal_acknowledgements(user_id, acknowledged_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_legal_acknowledgements_participant_id
  ON user_legal_acknowledgements(participant_id, acknowledged_at DESC);
