ALTER TABLE deals
RENAME COLUMN total_project_cost TO budgeted_project_cost;

ALTER TABLE deals
ADD COLUMN IF NOT EXISTS actual_project_cost REAL;

UPDATE deals
SET actual_project_cost = budgeted_project_cost
WHERE actual_project_cost IS NULL;

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

INSERT INTO deal_debt_service_entries (
  id,
  deal_id,
  interest_month,
  draw_balance,
  interest_paid,
  created_at,
  updated_at
)
SELECT
  'debt-service-' || deals.id || '-legacy',
  deals.id,
  SUBSTRING(COALESCE(deals.actual_exit_on, deals.projected_exit_on, deals.funded_on) FROM 1 FOR 7),
  deals.debt,
  deals.total_interest_paid,
  NOW()::text,
  NOW()::text
FROM deals
WHERE deals.total_interest_paid > 0
  AND NOT EXISTS (
    SELECT 1
    FROM deal_debt_service_entries
    WHERE deal_debt_service_entries.deal_id = deals.id
  );

CREATE INDEX IF NOT EXISTS idx_deal_debt_service_entries_deal_id
  ON deal_debt_service_entries(deal_id, interest_month);
