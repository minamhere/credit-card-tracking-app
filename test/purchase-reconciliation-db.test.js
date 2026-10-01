const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { projectExternalTransaction, normalizeMerchant } = require('../transaction-reconciliation');
const { findPurchaseMatches } = require('../purchase-reconciliation');
const { loadRepairPlan, applyRepairPlan } = require('../repair-plaid-duplicates');

test('PostgreSQL matching and archived duplicate repair preserve originals and provider links', {
  skip: !process.env.PGLITE_TEST_MODULE
}, async () => {
  const { PGlite } = require(process.env.PGLITE_TEST_MODULE);
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE transactions (id INTEGER PRIMARY KEY, person_id INTEGER, date TEXT,
        amount REAL, merchant TEXT, raw_merchant TEXT, transaction_type TEXT, source TEXT, categories TEXT[]);
      CREATE TABLE financial_connections (id INTEGER PRIMARY KEY, environment TEXT);
      CREATE TABLE financial_accounts (id INTEGER PRIMARY KEY, persistent_account_id TEXT, provider_account_id TEXT);
      CREATE TABLE external_transactions (id INTEGER PRIMARY KEY, person_id INTEGER, connection_id INTEGER,
        financial_account_id INTEGER, item_generation INTEGER, linked_transaction_id INTEGER UNIQUE REFERENCES transactions(id),
        supersedes_external_transaction_id INTEGER, lifecycle_status TEXT, pending BOOLEAN,
        transaction_kind TEXT, transaction_date DATE, amount NUMERIC, raw_description TEXT, updated_at TIMESTAMP);
      CREATE TABLE offer_credits (id INTEGER PRIMARY KEY, source_transaction_id INTEGER REFERENCES transactions(id));
      CREATE TABLE transaction_duplicate_repairs (duplicate_transaction_id INTEGER PRIMARY KEY,
        original_transaction_id INTEGER, external_transaction_id INTEGER, duplicate_snapshot JSONB,
        original_snapshot JSONB, external_snapshot JSONB);
      INSERT INTO financial_connections VALUES (1, 'production');
      INSERT INTO financial_accounts VALUES (1, 'card-1', 'account-1');
      INSERT INTO transactions VALUES (31, 7, '2026-09-06', 9.7, 'Stadium Concessions',
        'STADIUM GENER CITY CO', 'purchase', 'citi_csv', ARRAY['restaurant']);
      INSERT INTO offer_credits VALUES (1, 31);
    `);
    const candidate = { personId: 7, date: '2026-09-06', amount: 9.7, merchant: 'Stadium Concessions',
      rawMerchant: 'STADIUM GENER', external: true, connectionId: 1, itemGeneration: 1, accountId: 1 };
    assert.equal((await findPurchaseMatches(db, candidate, { lock: true }))[0].id, 31);
    assert.equal((await findPurchaseMatches(db, { ...candidate, date: '2026-09-07' })).length, 0);
    // Execute the actual confirmation route, not a copy of its matching logic.
    await db.exec(`ALTER TABLE financial_accounts ADD COLUMN selected BOOLEAN DEFAULT TRUE;
      ALTER TABLE financial_connections ADD COLUMN import_start_date DATE DEFAULT '2026-01-01';
      ALTER TABLE transactions ADD COLUMN source_hash TEXT;
      CREATE TABLE import_batches (id SERIAL PRIMARY KEY, person_id INTEGER, source TEXT,
        filename TEXT, file_hash TEXT, record_count INTEGER, imported_count INTEGER);
      INSERT INTO external_transactions VALUES (2, 7, 1, 1, 1, NULL, NULL, 'awaiting_review', FALSE,
        'purchase', '2026-09-06', 9.7, 'STADIUM GENER', CURRENT_TIMESTAMP);`);
    let handler;
    const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = serverSource.indexOf("app.post('/api/transaction-imports/confirm'");
    const route = serverSource.slice(start, serverSource.indexOf('\n});', start) + 5);
    vm.runInNewContext(route, {
      app: { post(_path, callback) { handler = callback; } },
      pool: { connect: async () => ({ query: (...args) => db.query(...args), release() {} }) },
      positiveInteger: value => Number(value), plaidConfig: { environment: 'production' },
      // PGlite emits DATE at UTC midnight; pg emits a local calendar Date.
      projectExternalTransaction: row => projectExternalTransaction({ ...row,
        transaction_date: row.transaction_date instanceof Date ? row.transaction_date.toISOString().slice(0, 10) : row.transaction_date }),
      findPurchaseMatches, normalizeMerchant,
      transactionHash: () => 'csv-hash', providerTransactionHash: () => 'provider-hash',
      autoMatchOfferCredits: async () => [], CreditMatcher: { isPotentialOfferCredit: () => false },
      console: { error(_message, error) { throw error; } }
    });
    const updated = (await db.query('SELECT updated_at FROM external_transactions WHERE id = 2')).rows[0].updated_at;
    let response;
    await handler({ body: { personId: 7, importMetadata: { source: 'plaid' }, transactions: [{
      date: candidate.date, amount: candidate.amount, merchant: candidate.merchant, categories: ['general'],
      externalTransactionId: 2, externalUpdatedAt: updated
    }] } }, { json(value) { response = value; }, status(code) { throw new Error(`HTTP ${code}`); } });
    assert.equal(response.imported, 0);
    assert.equal(response.skipped, 1);
    assert.equal((await db.query('SELECT id FROM transactions')).rows.length, 1);
    assert.equal((await db.query('SELECT linked_transaction_id FROM external_transactions WHERE id = 2')).rows[0].linked_transaction_id, 31);
    assert.deepEqual((await db.query('SELECT categories FROM transactions WHERE id = 31')).rows[0].categories, ['restaurant']);
    await db.exec('DELETE FROM external_transactions WHERE id = 2');
    await db.exec(`INSERT INTO transactions (id, person_id, date, amount, merchant, raw_merchant, transaction_type, source, categories)
      VALUES (40, 7, '2026-09-06', 9.7, 'Stadium Concessions', 'STADIUM GENER', 'purchase', 'plaid', ARRAY['general']);
      INSERT INTO external_transactions VALUES (1, 7, 1, 1, 1, 40, NULL, 'imported', FALSE,
        'purchase', '2026-09-06', 9.7, 'STADIUM GENER', CURRENT_TIMESTAMP);`);
    const plan = await loadRepairPlan(db, 'production');
    assert.equal(plan.pairs.length, 1);
    await db.exec('BEGIN');
    await applyRepairPlan(db, plan);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT id FROM transactions WHERE id = 40')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM transaction_duplicate_repairs')).rows.length, 0);
    await db.exec('BEGIN');
    await applyRepairPlan(db, plan);
    await db.exec('COMMIT');
    assert.equal((await db.query('SELECT id FROM transactions WHERE id = 40')).rows.length, 0);
    assert.deepEqual((await db.query('SELECT categories FROM transactions WHERE id = 31')).rows[0].categories, ['restaurant']);
    assert.equal((await db.query('SELECT linked_transaction_id FROM external_transactions')).rows[0].linked_transaction_id, 31);
    assert.equal((await db.query('SELECT source_transaction_id FROM offer_credits')).rows[0].source_transaction_id, 31);
    assert.equal((await db.query('SELECT duplicate_snapshot FROM transaction_duplicate_repairs')).rows[0].duplicate_snapshot.id, 40);
    assert.equal((await loadRepairPlan(db, 'production')).pairs.length, 0);
    // Once linked, a different provider ID cannot consume the same CSV record.
    assert.equal((await findPurchaseMatches(db, candidate)).length, 0);
    // Importing a CSV after Plaid uses the same merchant fallback in reverse.
    await db.exec(`INSERT INTO transactions (id, person_id, date, amount, merchant, raw_merchant, transaction_type, source, categories)
      VALUES (50, 7, '2026-09-08', 25, 'Market',
      'Market', 'purchase', 'plaid', ARRAY['grocery']);`);
    assert.equal((await findPurchaseMatches(db, { personId: 7, date: '2026-09-08', amount: 25,
      merchant: 'Market', rawMerchant: 'MARKET CITY CO', external: false }))[0].id, 50);
  } finally {
    await db.close();
  }
});
