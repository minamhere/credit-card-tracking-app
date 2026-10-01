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

CREATE TABLE IF NOT EXISTS m365_sync_state (
    folder_path TEXT PRIMARY KEY,
    folder_id TEXT,
    delta_link TEXT,
    last_success_at TIMESTAMP,
    last_error TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_ingestions (
    id SERIAL PRIMARY KEY,
    graph_message_id TEXT NOT NULL UNIQUE,
    internet_message_id TEXT,
    mailbox TEXT NOT NULL,
    folder_path TEXT NOT NULL,
    person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    received_at TIMESTAMP,
    sender TEXT,
    subject TEXT,
    body_text TEXT,
    body_hash TEXT,
    classification TEXT NOT NULL,
    processing_status TEXT NOT NULL DEFAULT 'review',
    parsed_offer JSONB,
    offer_fingerprint TEXT,
    linked_offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
    classification_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS email_ingestions_status_idx ON email_ingestions (processing_status, received_at DESC);

-- Plaid connection state and review-first external transaction staging.
CREATE TABLE IF NOT EXISTS financial_connections (
    id SERIAL PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'plaid' CHECK (provider IN ('plaid')),
    provider_item_id TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
    access_token_ciphertext TEXT NOT NULL,
    access_token_nonce TEXT NOT NULL,
    access_token_auth_tag TEXT NOT NULL,
    access_token_key_version INTEGER NOT NULL DEFAULT 1,
    sync_cursor TEXT,
    status TEXT NOT NULL DEFAULT 'account_selection'
        CHECK (status IN ('account_selection', 'healthy', 'attention_required', 'error', 'disconnected')),
    last_error_code TEXT,
    last_error_request_id TEXT,
    last_attempt_at TIMESTAMP,
    last_success_at TIMESTAMP,
    consent_expiration_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider, provider_item_id),
    UNIQUE (person_id, provider, environment)
);

CREATE TABLE IF NOT EXISTS financial_accounts (
    id SERIAL PRIMARY KEY,
    connection_id INTEGER NOT NULL REFERENCES financial_connections(id) ON DELETE CASCADE,
    provider_account_id TEXT NOT NULL,
    persistent_account_id TEXT,
    display_name TEXT NOT NULL,
    official_name TEXT,
    account_type TEXT,
    account_subtype TEXT,
    mask TEXT,
    selected BOOLEAN NOT NULL DEFAULT FALSE,
    available BOOLEAN NOT NULL DEFAULT TRUE,
    discovered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (connection_id, provider_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_accounts_one_selected_idx
    ON financial_accounts (connection_id) WHERE selected;
ALTER TABLE financial_accounts ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS external_transactions (
    id SERIAL PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'plaid' CHECK (provider IN ('plaid')),
    provider_transaction_id TEXT NOT NULL,
    connection_id INTEGER NOT NULL REFERENCES financial_connections(id) ON DELETE CASCADE,
    financial_account_id INTEGER NOT NULL REFERENCES financial_accounts(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    pending_provider_transaction_id TEXT,
    pending BOOLEAN NOT NULL DEFAULT FALSE,
    transaction_date DATE NOT NULL,
    authorized_date DATE,
    amount DECIMAL(14,2) NOT NULL,
    raw_description TEXT NOT NULL,
    merchant_name TEXT,
    provider_category TEXT,
    transaction_kind TEXT NOT NULL
        CHECK (transaction_kind IN ('purchase', 'payment', 'refund', 'credit', 'interest', 'fee')),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    lifecycle_status TEXT NOT NULL DEFAULT 'staged'
        CHECK (lifecycle_status IN ('staged', 'awaiting_review', 'imported', 'ignored', 'removed', 'conflicted')),
    linked_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    linked_account_event_id INTEGER REFERENCES account_events(id) ON DELETE SET NULL,
    first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider, provider_transaction_id)
);
CREATE INDEX IF NOT EXISTS external_transactions_review_idx
    ON external_transactions (person_id, lifecycle_status, transaction_date DESC);
CREATE INDEX IF NOT EXISTS external_transactions_connection_idx
    ON external_transactions (connection_id, financial_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS external_transactions_one_linked_transaction_idx
    ON external_transactions (linked_transaction_id) WHERE linked_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS external_transactions_one_linked_event_idx
    ON external_transactions (linked_account_event_id) WHERE linked_account_event_id IS NOT NULL;

-- One-time clean slate requested for the redesigned importer. Keep the people
-- records so the existing cardholder selection remains usable, but remove all
-- offer, transaction, import, credit, and merchant-classification data. The
-- marker lives in the persistent database volume, so container restarts and
-- rebuilds cannot accidentally run this reset again.
CREATE TABLE IF NOT EXISTS app_migration_history (
    migration_key TEXT PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM app_migration_history
        WHERE migration_key = 'one_time_clean_reset_2026_09_27'
    ) THEN
        TRUNCATE TABLE
            account_events,
            offer_credits,
            import_batches,
            merchant_category_rules,
            transactions,
            offers
        RESTART IDENTITY CASCADE;

        INSERT INTO app_migration_history (migration_key)
        VALUES ('one_time_clean_reset_2026_09_27');
    END IF;
END $$;
