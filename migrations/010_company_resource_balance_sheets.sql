ALTER TABLE company_resources
ADD COLUMN IF NOT EXISTS deal_id TEXT REFERENCES deals(id) ON DELETE CASCADE;

ALTER TABLE company_resources
DROP CONSTRAINT IF EXISTS company_resources_resource_type_check;

ALTER TABLE company_resources
ADD CONSTRAINT company_resources_resource_type_check CHECK (
  resource_type IN ('bylaw_document', 'announcement', 'project_balance_sheet')
  AND (resource_type <> 'project_balance_sheet' OR deal_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_company_resources_deal_id
  ON company_resources(deal_id, published_at DESC, created_at DESC);
