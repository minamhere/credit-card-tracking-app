const { normalizeMerchant, formatCalendarDate } = require('./transaction-reconciliation');

function purchaseMatches(candidate, row) {
  const day = formatCalendarDate(row.date);
  const distance = Math.abs(Date.parse(`${day}T00:00:00Z`) - Date.parse(`${candidate.date}T00:00:00Z`)) / 86400000;
  if (Number(row.person_id) !== Number(candidate.personId) || distance > 3 ||
      row.transaction_type !== 'purchase' || Math.abs(Number(row.amount) - Number(candidate.amount)) >= 0.001) return false;
  const raw = normalizeMerchant(candidate.rawMerchant);
  const merchant = normalizeMerchant(candidate.merchant);
  // Description equality allows the usual posted-date drift. Display-name
  // fallback is deliberately restricted to the exact same calendar date.
  return Boolean(raw && raw === normalizeMerchant(row.raw_merchant || row.merchant)) ||
    Boolean(distance === 0 && merchant && merchant === normalizeMerchant(row.merchant));
}

async function findPurchaseMatches(queryable, candidate, { lock = false } = {}) {
  const result = await queryable.query(`
    SELECT t.*, old.id AS old_external_id FROM transactions t
    LEFT JOIN external_transactions old ON old.linked_transaction_id = t.id
      AND old.connection_id = $4 AND old.item_generation < $5
    LEFT JOIN financial_accounts old_account ON old_account.id = old.financial_account_id
    LEFT JOIN financial_accounts new_account ON new_account.id = $6
    WHERE t.person_id = $1 AND t.transaction_type = 'purchase'
      AND t.date::date BETWEEN $2::date - 3 AND $2::date + 3
      AND ABS(t.amount - $3::numeric) < 0.001
      AND (
        ($7::boolean AND (
          (t.source <> 'plaid' AND NOT EXISTS (SELECT 1 FROM external_transactions linked WHERE linked.linked_transaction_id = t.id))
          OR (old.id IS NOT NULL
            AND COALESCE(old_account.persistent_account_id, old_account.provider_account_id)
              = COALESCE(new_account.persistent_account_id, new_account.provider_account_id)
            AND NOT EXISTS (SELECT 1 FROM external_transactions successor WHERE successor.supersedes_external_transaction_id = old.id))
        )) OR (NOT $7::boolean AND t.source = 'plaid')
      )
    ORDER BY t.id ${lock ? 'FOR UPDATE OF t' : ''}
  `, [candidate.personId, candidate.date, candidate.amount, candidate.connectionId || 0,
    candidate.itemGeneration || 0, candidate.accountId || 0, Boolean(candidate.external)]);
  return result.rows.filter(row => purchaseMatches(candidate, row));
}

module.exports = { purchaseMatches, findPurchaseMatches };
