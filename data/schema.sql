CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('sponsor', 'investor', 'contractor', 'manager')),
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  driver_license_number TEXT,
  id_card_file_name TEXT,
  id_card_mime_type TEXT,
  id_card_data_url TEXT,
  current_address TEXT,
  mailing_address TEXT,
  contact_phone TEXT,
  payout_method TEXT,
  bank_account_name TEXT,
  bank_name TEXT,
  bank_routing_number TEXT,
  bank_account_number TEXT,
  zelle_details TEXT,
  cash_app_handle TEXT,
  payout_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('manager', 'investor')),
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  location TEXT NOT NULL,
  total_equity REAL NOT NULL DEFAULT 0,
  debt REAL NOT NULL DEFAULT 0,
  total_project_cost REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  hold_months INTEGER NOT NULL DEFAULT 0,
  pref_rate REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('under_construction', 'listed', 'sold')),
  current_phase TEXT NOT NULL,
  funded_on TEXT NOT NULL,
  projected_exit_on TEXT,
  actual_exit_on TEXT,
  timeline_progress INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promote_tiers (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  label TEXT NOT NULL,
  hurdle REAL NOT NULL,
  investor_share REAL NOT NULL,
  sponsor_share REAL NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  UNIQUE (deal_id, sort_order)
);

CREATE TABLE IF NOT EXISTS deal_timeline_items (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  label TEXT NOT NULL,
  milestone_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'in_progress', 'upcoming')),
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  UNIQUE (deal_id, sort_order)
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  class_type TEXT NOT NULL CHECK (class_type IN ('Class A', 'Class B', 'Class C')),
  contribution_type TEXT NOT NULL,
  contribution_amount REAL NOT NULL DEFAULT 0,
  distributions_to_date REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  UNIQUE (deal_id, participant_id)
);

CREATE TABLE IF NOT EXISTS contractor_participation (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  trade TEXT NOT NULL,
  total_contract_value REAL NOT NULL DEFAULT 0,
  cash_paid REAL NOT NULL DEFAULT 0,
  deferred_amount REAL NOT NULL DEFAULT 0,
  contribution_type TEXT NOT NULL,
  hybrid INTEGER NOT NULL DEFAULT 0 CHECK (hybrid IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('Active', 'Completed', 'Paid')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  UNIQUE (deal_id, participant_id)
);

CREATE TABLE IF NOT EXISTS email_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'saved_local', 'failed')),
  provider TEXT NOT NULL,
  local_path TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_positions_deal_id ON positions(deal_id);
CREATE INDEX IF NOT EXISTS idx_positions_participant_id ON positions(participant_id);
CREATE INDEX IF NOT EXISTS idx_contractor_deal_id ON contractor_participation(deal_id);
CREATE INDEX IF NOT EXISTS idx_timeline_deal_id ON deal_timeline_items(deal_id);
CREATE INDEX IF NOT EXISTS idx_promote_tiers_deal_id ON promote_tiers(deal_id);
CREATE INDEX IF NOT EXISTS idx_email_notifications_user_id ON email_notifications(user_id, created_at DESC);
