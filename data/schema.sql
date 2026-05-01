CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('sponsor', 'investor', 'contractor', 'manager', 'pool_member', 'pool')
  ),
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

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

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
  investment_amount REAL,
  deferred_amount REAL,
  proof_of_payment_file_name TEXT,
  proof_of_payment_mime_type TEXT,
  proof_of_payment_data_url TEXT,
  acknowledged_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  UNIQUE (user_id, document_key, document_version)
);

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

CREATE TABLE IF NOT EXISTS user_allocation_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  participant_category TEXT NOT NULL CHECK (
    participant_category IN ('investor', 'pool_member', 'contractor')
  ),
  amount REAL NOT NULL CHECK (amount > 0),
  class_type TEXT NOT NULL CHECK (class_type IN ('Class A', 'Class B', 'Class C')),
  contribution_type TEXT NOT NULL,
  trade TEXT,
  participant_notes TEXT,
  manager_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_position_id TEXT,
  submitted_at TEXT NOT NULL,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  FOREIGN KEY (created_position_id) REFERENCES positions(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

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

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  location TEXT NOT NULL,
  total_equity REAL NOT NULL DEFAULT 0,
  debt REAL NOT NULL DEFAULT 0,
  tax_expense REAL NOT NULL DEFAULT 0,
  debt_interest_rate REAL NOT NULL DEFAULT 0,
  total_interest_paid REAL NOT NULL DEFAULT 0,
  early_withdrawal_penalty_rate REAL NOT NULL DEFAULT 0.30,
  budgeted_project_cost REAL NOT NULL DEFAULT 0,
  actual_project_cost REAL,
  sale_price REAL NOT NULL DEFAULT 0,
  hold_months INTEGER NOT NULL DEFAULT 0,
  pref_rate REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('under_construction', 'listed', 'sold')),
  current_phase TEXT NOT NULL,
  funded_on TEXT NOT NULL,
  investment_close_on TEXT,
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
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
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

CREATE TABLE IF NOT EXISTS deal_debt_service_entries (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  interest_month TEXT NOT NULL CHECK (interest_month ~ '^\d{4}-\d{2}$'),
  draw_balance REAL NOT NULL DEFAULT 0 CHECK (draw_balance >= 0),
  interest_paid REAL NOT NULL DEFAULT 0 CHECK (interest_paid >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  UNIQUE (deal_id, interest_month)
);

CREATE TABLE IF NOT EXISTS deal_expense_entries (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  stage_label TEXT NOT NULL,
  payee_name TEXT NOT NULL,
  amount_paid REAL NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  paid_on TEXT,
  notes TEXT,
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

CREATE TABLE IF NOT EXISTS distribution_elections (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  election_mode TEXT NOT NULL CHECK (
    election_mode IN ('payout_all', 'reinvest_all', 'split_percentage', 'split_amount')
  ),
  reinvest_percent REAL,
  reinvest_amount REAL,
  rollover_target_deal_id TEXT,
  notes TEXT,
  submitted_by_user_id TEXT,
  submitted_by_role TEXT CHECK (submitted_by_role IN ('investor', 'manager')),
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved')),
  approved_reinvest_amount REAL,
  approved_cash_payout_amount REAL,
  payout_expected_on TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  manager_override INTEGER NOT NULL DEFAULT 0 CHECK (manager_override IN (0, 1)),
  override_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (rollover_target_deal_id) REFERENCES deals(id) ON DELETE SET NULL,
  FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (deal_id, participant_id)
);

CREATE TABLE IF NOT EXISTS early_withdrawal_requests (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  position_id TEXT,
  class_type TEXT CHECK (class_type IN ('Class A', 'Class B', 'Class C')),
  requested_capital_amount REAL NOT NULL DEFAULT 0,
  penalty_rate REAL NOT NULL DEFAULT 0,
  penalty_amount REAL NOT NULL DEFAULT 0,
  approved_payout_amount REAL,
  investor_notes TEXT,
  manager_notes TEXT,
  request_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    request_status IN ('pending', 'approved', 'rejected')
  ),
  payout_expected_on TEXT,
  requested_by_user_id TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS company_resources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  deal_id TEXT,
  resource_type TEXT NOT NULL CHECK (
    resource_type IN ('bylaw_document', 'announcement', 'project_balance_sheet')
    AND (resource_type <> 'project_balance_sheet' OR deal_id IS NOT NULL)
  ),
  summary_text TEXT,
  body_text TEXT,
  file_name TEXT,
  file_mime_type TEXT,
  file_data_url TEXT,
  published_at TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS deal_issues (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  issue_type TEXT NOT NULL DEFAULT 'general' CHECK (issue_type IN ('general', 'penalty_rate_change')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  approval_threshold REAL NOT NULL DEFAULT 0.75 CHECK (approval_threshold > 0 AND approval_threshold <= 1),
  proposed_penalty_rate REAL,
  closes_on TEXT,
  resolution_result TEXT,
  resolution_applied_at TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS deal_issue_votes (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  vote_choice TEXT NOT NULL CHECK (vote_choice IN ('yes', 'no')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES deal_issues(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  UNIQUE (issue_id, participant_id)
);

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

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_legal_acknowledgements_user_id
  ON user_legal_acknowledgements(user_id, acknowledged_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_legal_acknowledgements_participant_id
  ON user_legal_acknowledgements(participant_id, acknowledged_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_capital_deposits_user_id
  ON user_capital_deposits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_capital_deposits_participant_id
  ON user_capital_deposits(participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_capital_deposits_status
  ON user_capital_deposits(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_allocation_requests_participant_id
  ON user_allocation_requests(participant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_allocation_requests_deal_id
  ON user_allocation_requests(deal_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_allocation_requests_status
  ON user_allocation_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investor_questionnaires_participant_id
  ON investor_questionnaires(participant_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_investor_questionnaires_submitted_at
  ON investor_questionnaires(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON password_reset_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_positions_deal_id ON positions(deal_id);
CREATE INDEX IF NOT EXISTS idx_positions_participant_id ON positions(participant_id);
CREATE INDEX IF NOT EXISTS idx_investor_pools_status ON investor_pools(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investor_pool_commitments_pool_id
  ON investor_pool_commitments(pool_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_investor_pool_votes_pool_id
  ON investor_pool_votes(pool_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_distribution_elections_deal_id
  ON distribution_elections(deal_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_early_withdrawal_requests_deal_id
  ON early_withdrawal_requests(deal_id, participant_id, request_status);

CREATE INDEX IF NOT EXISTS idx_deal_debt_service_entries_deal_id
  ON deal_debt_service_entries(deal_id, interest_month);

CREATE INDEX IF NOT EXISTS idx_deal_expense_entries_deal_id
  ON deal_expense_entries(deal_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_contractor_deal_id ON contractor_participation(deal_id);
CREATE INDEX IF NOT EXISTS idx_timeline_deal_id ON deal_timeline_items(deal_id);
CREATE INDEX IF NOT EXISTS idx_promote_tiers_deal_id ON promote_tiers(deal_id);
CREATE INDEX IF NOT EXISTS idx_email_notifications_user_id ON email_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_resources_published_at
  ON company_resources(published_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_resources_deal_id
  ON company_resources(deal_id, published_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_issues_deal_id ON deal_issues(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_issue_votes_issue_id ON deal_issue_votes(issue_id);
CREATE INDEX IF NOT EXISTS idx_archived_records_entity_type
  ON archived_records(entity_type, deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_archived_records_entity_id
  ON archived_records(entity_id, deleted_at DESC);
