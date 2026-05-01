ALTER TABLE deals
ADD COLUMN IF NOT EXISTS direct_investment_minimum REAL NOT NULL DEFAULT 0 CHECK (direct_investment_minimum >= 0);

ALTER TABLE deals
ADD COLUMN IF NOT EXISTS pooled_investment_allowed INTEGER NOT NULL DEFAULT 1 CHECK (pooled_investment_allowed IN (0, 1));

ALTER TABLE deals
ADD COLUMN IF NOT EXISTS pooled_investment_target REAL NOT NULL DEFAULT 0 CHECK (pooled_investment_target >= 0);

ALTER TABLE user_allocation_requests
ADD COLUMN IF NOT EXISTS allocation_mode TEXT NOT NULL DEFAULT 'direct';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_allocation_requests_allocation_mode_check'
  ) THEN
    ALTER TABLE user_allocation_requests
    ADD CONSTRAINT user_allocation_requests_allocation_mode_check
      CHECK (allocation_mode IN ('direct', 'pooled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_allocation_requests_deal_mode_status
  ON user_allocation_requests(deal_id, allocation_mode, status, created_at DESC);
