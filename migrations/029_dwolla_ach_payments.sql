ALTER TABLE users
  ADD COLUMN IF NOT EXISTS dwolla_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS dwolla_customer_url TEXT,
  ADD COLUMN IF NOT EXISTS dwolla_customer_status TEXT,
  ADD COLUMN IF NOT EXISTS dwolla_funding_source_id TEXT,
  ADD COLUMN IF NOT EXISTS dwolla_funding_source_url TEXT,
  ADD COLUMN IF NOT EXISTS dwolla_funding_source_status TEXT,
  ADD COLUMN IF NOT EXISTS dwolla_funding_source_name TEXT,
  ADD COLUMN IF NOT EXISTS dwolla_funding_source_bank_name TEXT,
  ADD COLUMN IF NOT EXISTS dwolla_funding_source_type TEXT,
  ADD COLUMN IF NOT EXISTS dwolla_synced_at TEXT;

ALTER TABLE user_capital_deposits
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS provider_name TEXT,
  ADD COLUMN IF NOT EXISTS provider_transfer_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_transfer_url TEXT,
  ADD COLUMN IF NOT EXISTS provider_transfer_status TEXT,
  ADD COLUMN IF NOT EXISTS provider_correlation_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS provider_raw_event JSONB;

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  resource_id TEXT,
  resource_url TEXT,
  raw_body TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_dwolla_customer_id
  ON users(dwolla_customer_id);

CREATE INDEX IF NOT EXISTS idx_users_dwolla_funding_source_id
  ON users(dwolla_funding_source_id);

CREATE INDEX IF NOT EXISTS idx_user_capital_deposits_provider_transfer
  ON user_capital_deposits(provider_name, provider_transfer_id);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_provider_topic
  ON payment_webhook_events(provider, topic, created_at DESC);
