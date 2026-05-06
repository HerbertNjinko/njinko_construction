CREATE TABLE IF NOT EXISTS user_questions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  question_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'answered', 'closed')
  ),
  response_text TEXT,
  responded_by_user_id TEXT,
  responded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (responded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_questions_user_id
  ON user_questions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_questions_participant_id
  ON user_questions(participant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_questions_status
  ON user_questions(status, created_at DESC);
