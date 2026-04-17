ALTER TABLE distribution_elections
ADD COLUMN IF NOT EXISTS approval_status TEXT;

UPDATE distribution_elections
SET approval_status = CASE
  WHEN reviewed_at IS NOT NULL THEN 'approved'
  ELSE 'pending'
END
WHERE approval_status IS NULL;

ALTER TABLE distribution_elections
ALTER COLUMN approval_status SET DEFAULT 'pending';

ALTER TABLE distribution_elections
ALTER COLUMN approval_status SET NOT NULL;

ALTER TABLE distribution_elections
DROP CONSTRAINT IF EXISTS distribution_elections_approval_status_check;

ALTER TABLE distribution_elections
ADD CONSTRAINT distribution_elections_approval_status_check
CHECK (approval_status IN ('pending', 'approved'));

ALTER TABLE distribution_elections
ADD COLUMN IF NOT EXISTS approved_reinvest_amount REAL;

ALTER TABLE distribution_elections
ADD COLUMN IF NOT EXISTS approved_cash_payout_amount REAL;

ALTER TABLE distribution_elections
ADD COLUMN IF NOT EXISTS payout_expected_on TEXT;
