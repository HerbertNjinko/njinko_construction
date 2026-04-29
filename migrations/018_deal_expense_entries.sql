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

INSERT INTO deal_expense_entries (
  id,
  deal_id,
  stage_label,
  payee_name,
  amount_paid,
  paid_on,
  notes,
  sort_order,
  created_at,
  updated_at
)
SELECT
  'expense-' || deals.id || '-legacy',
  deals.id,
  'Imported project cost',
  'Legacy carry-forward',
  COALESCE(deals.actual_project_cost, deals.budgeted_project_cost, 0),
  COALESCE(deals.actual_exit_on, deals.projected_exit_on, deals.funded_on),
  'Backfilled from the previous project cost total.',
  1,
  NOW()::text,
  NOW()::text
FROM deals
WHERE COALESCE(deals.actual_project_cost, deals.budgeted_project_cost, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM deal_expense_entries
    WHERE deal_expense_entries.deal_id = deals.id
  );

CREATE INDEX IF NOT EXISTS idx_deal_expense_entries_deal_id
  ON deal_expense_entries(deal_id, sort_order);
