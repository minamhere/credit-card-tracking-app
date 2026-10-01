const crypto = require('node:crypto');
const { normalizeMerchant, formatCalendarDate } = require('./transaction-reconciliation');

function buildRepairPlan(newRows, originals) {
  const candidates = newRows.map(({ transaction, external }) => {
    const unchanged = external.lifecycle_status === 'imported' && !external.pending &&
      external.transaction_kind === 'purchase' && transaction.transaction_type === 'purchase' &&
      formatCalendarDate(transaction.date) === formatCalendarDate(external.transaction_date) &&
      Math.abs(Number(transaction.amount) - Number(external.amount)) < 0.001 &&
      transaction.raw_merchant === external.raw_description;
    const matches = unchanged ? originals.filter(original =>
      Number(original.id) < Number(transaction.id) && Number(original.person_id) === Number(transaction.person_id) &&
      original.source === 'citi_csv' && original.transaction_type === 'purchase' &&
      formatCalendarDate(original.date) === formatCalendarDate(transaction.date) &&
      Math.abs(Number(original.amount) - Number(transaction.amount)) < 0.001 &&
      normalizeMerchant(original.merchant) && normalizeMerchant(original.merchant) === normalizeMerchant(transaction.merchant)
    ) : [];
    return { transaction, external, matches };
  });
  const pairs = candidates.filter(candidate => candidate.matches.length === 1 &&
    candidates.filter(other => other.matches.some(match => Number(match.id) === Number(candidate.matches[0].id))).length === 1
  ).map(({ transaction, external, matches }) => ({ duplicate: transaction, original: matches[0], external }));
  const token = crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex').slice(0, 24);
  return { pairs, token, skipped: newRows.length - pairs.length };
}

async function loadRepairPlan(client, environment) {
  const result = await client.query(`
    SELECT to_jsonb(t) AS transaction, to_jsonb(et) AS external
    FROM transactions t
    JOIN external_transactions et ON et.linked_transaction_id = t.id
    JOIN financial_connections c ON c.id = et.connection_id AND c.environment = $1
    WHERE t.source = 'plaid' AND t.person_id = et.person_id
      AND NOT EXISTS (SELECT 1 FROM offer_credits oc WHERE oc.source_transaction_id = t.id)
    ORDER BY t.id
  `, [environment]);
  const originals = await client.query(`
    SELECT t.* FROM transactions t
    WHERE t.source = 'citi_csv' AND t.transaction_type = 'purchase'
      AND NOT EXISTS (SELECT 1 FROM external_transactions et WHERE et.linked_transaction_id = t.id)
    ORDER BY t.id
  `);
  return buildRepairPlan(result.rows, originals.rows);
}

async function applyRepairPlan(client, plan) {
  for (const pair of plan.pairs) {
    await client.query(`INSERT INTO transaction_duplicate_repairs
      (duplicate_transaction_id, original_transaction_id, external_transaction_id,
       duplicate_snapshot, original_snapshot, external_snapshot)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)`,
    [pair.duplicate.id, pair.original.id, pair.external.id,
      JSON.stringify(pair.duplicate), JSON.stringify(pair.original), JSON.stringify(pair.external)]);
    await client.query(`UPDATE external_transactions
      SET linked_transaction_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND linked_transaction_id = $3`, [pair.original.id, pair.external.id, pair.duplicate.id]);
    await client.query("DELETE FROM transactions WHERE id = $1 AND source = 'plaid'", [pair.duplicate.id]);
  }
}

async function main() {
  const { Pool } = require('pg');
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--apply' || !/^[a-f0-9]{24}$/.test(args[1]))) {
    throw new Error('Usage: node repair-plaid-duplicates.js [--apply PREVIEW_TOKEN]');
  }
  const environment = process.env.PLAID_ENV;
  if (!['sandbox', 'production'].includes(environment)) throw new Error('PLAID_ENV must be sandbox or production.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (args.length) {
      // Serialize against imports, sync, edits and credit matching while checking
      // the preview snapshots and moving provider links. Any error rolls back.
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query('LOCK TABLE transactions, external_transactions, financial_connections, offer_credits IN SHARE ROW EXCLUSIVE MODE');
    }
    const plan = await loadRepairPlan(client, environment);
    console.table(plan.pairs.map(pair => ({ duplicateId: pair.duplicate.id, keepId: pair.original.id,
      personId: pair.original.person_id, date: pair.original.date, merchant: pair.original.merchant, amount: pair.original.amount })));
    if (args.length) {
      if (args[1] !== plan.token) throw new Error('Data changed since preview. Run the preview again; nothing was changed.');
      await applyRepairPlan(client, plan);
      await client.query('COMMIT');
      console.log(`Reconciled ${plan.pairs.length} duplicate purchases. CSV originals preserved; Plaid copies archived in transaction_duplicate_repairs.`);
    } else {
      await client.query('ROLLBACK');
      console.log(`${plan.pairs.length} unique same-day CSV/Plaid pairs; ${plan.skipped} other Plaid records left alone. No changes made.`);
      if (plan.pairs.length) console.log(`After reviewing these pairs and taking a database backup, apply with: node repair-plaid-duplicates.js --apply ${plan.token}`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildRepairPlan, loadRepairPlan, applyRepairPlan };
