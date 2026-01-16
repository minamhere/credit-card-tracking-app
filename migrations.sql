-- Add percent-back columns to offers table
ALTER TABLE offers ADD COLUMN IF NOT EXISTS percent_back DECIMAL(5,2);
ALTER TABLE offers ADD COLUMN IF NOT EXISTS max_back DECIMAL(10,2);
ALTER TABLE offers ADD COLUMN IF NOT EXISTS min_spend_threshold DECIMAL(10,2);

-- Add bonus posted tracking column
ALTER TABLE offers ADD COLUMN IF NOT EXISTS bonus_posted BOOLEAN DEFAULT FALSE;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS bonus_posted_date DATE;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS bonus_posted_amount DECIMAL(10,2);

-- Add hidden column for hiding completed/expired offers
ALTER TABLE offers ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;
