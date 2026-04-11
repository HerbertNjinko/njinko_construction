CREATE TABLE IF NOT EXISTS archived_records (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  display_name TEXT,
  related_deal_id TEXT,
  related_participant_id TEXT,
  deleted_by_user_id TEXT,
  deleted_by_role TEXT,
  deleted_by_email TEXT,
  deleted_by_name TEXT,
  deleted_at TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archived_records_entity_type
  ON archived_records(entity_type, deleted_at DESC);

CREATE INDEX IF NOT EXISTS idx_archived_records_entity_id
  ON archived_records(entity_id, deleted_at DESC);
