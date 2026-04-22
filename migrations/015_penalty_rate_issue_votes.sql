ALTER TABLE deal_issues
ADD COLUMN IF NOT EXISTS issue_type TEXT NOT NULL DEFAULT 'general';

ALTER TABLE deal_issues
ADD COLUMN IF NOT EXISTS proposed_penalty_rate REAL;

ALTER TABLE deal_issues
ADD COLUMN IF NOT EXISTS resolution_result TEXT;

ALTER TABLE deal_issues
ADD COLUMN IF NOT EXISTS resolution_applied_at TEXT;

ALTER TABLE deal_issues
ADD CONSTRAINT deal_issues_issue_type_check
CHECK (issue_type IN ('general', 'penalty_rate_change'));
