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

-- CSV import provenance and duplicate protection
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_hash TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS raw_merchant TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'purchase';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_batch_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_person_source_hash_idx
    ON transactions (person_id, source_hash)
    WHERE source_hash IS NOT NULL;

-- Persistent merchant classification rules. A merchant may belong to multiple
-- bonus categories, so categories is intentionally an array.
CREATE TABLE IF NOT EXISTS merchant_category_rules (
    id SERIAL PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    merchant_pattern TEXT NOT NULL,
    merchant_name TEXT NOT NULL,
    match_type TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('exact', 'contains')),
    categories TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (person_id, merchant_pattern, match_type)
);

-- Merchant coding is shared across card holders. Keep person_id nullable for a
-- non-destructive migration from the earlier per-person design, merge duplicate
-- patterns by most recently updated rule, and enforce one global rule.
ALTER TABLE merchant_category_rules ALTER COLUMN person_id DROP NOT NULL;
WITH ranked_rules AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY merchant_pattern, match_type
               ORDER BY updated_at DESC, id DESC
           ) AS row_number
    FROM merchant_category_rules
)
DELETE FROM merchant_category_rules
WHERE id IN (SELECT id FROM ranked_rules WHERE row_number > 1);
UPDATE merchant_category_rules SET person_id = NULL WHERE person_id IS NOT NULL;
ALTER TABLE merchant_category_rules
    DROP CONSTRAINT IF EXISTS merchant_category_rules_person_id_merchant_pattern_match_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS merchant_category_rules_global_pattern_idx
    ON merchant_category_rules (merchant_pattern, match_type);

-- Rules-engine configuration. Legacy offer columns remain during migration so
-- existing deployments can roll forward without losing data.
ALTER TABLE offers ADD COLUMN IF NOT EXISTS eligibility JSONB;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS measurement JSONB;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS reward_config JSONB;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS engine_version INTEGER NOT NULL DEFAULT 2;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE offers ADD COLUMN IF NOT EXISTS source_external_id TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (review_status IN ('draft', 'confirmed', 'rejected'));
CREATE UNIQUE INDEX IF NOT EXISTS offers_source_external_id_idx
    ON offers (source_type, source_external_id)
    WHERE source_external_id IS NOT NULL;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS offer_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS offers_person_fingerprint_idx
    ON offers (person_id, offer_fingerprint)
    WHERE offer_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS offer_credits (
    id SERIAL PRIMARY KEY,
    offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    posted_date DATE,
    description TEXT DEFAULT '',
    source_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_batches (
    id SERIAL PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'citi_csv',
    filename TEXT,
    file_hash TEXT,
    record_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_events (
    id SERIAL PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    import_batch_id INTEGER REFERENCES import_batches(id) ON DELETE SET NULL,
    event_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT NOT NULL,
    event_type TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    assigned_offer_credit_id INTEGER REFERENCES offer_credits(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (person_id, source_hash)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_import_batch_fk') THEN
        ALTER TABLE transactions
            ADD CONSTRAINT transactions_import_batch_fk
            FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;
    END IF;
END $$;
