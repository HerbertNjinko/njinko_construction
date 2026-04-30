ALTER TABLE user_legal_acknowledgements
  ADD COLUMN IF NOT EXISTS investment_amount REAL,
  ADD COLUMN IF NOT EXISTS deferred_amount REAL,
  ADD COLUMN IF NOT EXISTS proof_of_payment_file_name TEXT,
  ADD COLUMN IF NOT EXISTS proof_of_payment_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS proof_of_payment_data_url TEXT;
