ALTER TABLE deals
ADD COLUMN IF NOT EXISTS tax_expense REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS company_resources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('bylaw_document', 'announcement')),
  summary_text TEXT,
  body_text TEXT,
  file_name TEXT,
  file_mime_type TEXT,
  file_data_url TEXT,
  published_at TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_company_resources_published_at
  ON company_resources(published_at DESC, created_at DESC);
