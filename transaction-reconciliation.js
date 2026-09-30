function normalizeMerchant(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function daysBetween(a, b) {
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  return Number.isFinite(left) && Number.isFinite(right) ? Math.abs(left - right) / 86400000 : Infinity;
}

function reconcileCandidate(candidate, existingRows) {
  const exact = existingRows.find(row =>
    row.personId === candidate.personId && candidate.providerTransactionId &&
    row.providerTransactionId === candidate.providerTransactionId
  );
  if (exact) return { status: 'duplicate', matchId: exact.id };

  const matches = existingRows.filter(row => {
    if (row.personId !== candidate.personId) return false;
    if (candidate.source === 'plaid' && row.source === 'plaid' && row.providerTransactionId) return false;
    return daysBetween(row.date, candidate.date) <= 3 &&
      Math.abs(Number(row.amount)) === Math.abs(Number(candidate.amount)) &&
      (row.transactionType || 'purchase') === (candidate.transactionType || 'purchase') &&
      normalizeMerchant(row.rawMerchant || row.merchant) === normalizeMerchant(candidate.rawMerchant || candidate.merchant);
  });
  if (matches.length === 1) return { status: 'duplicate', matchId: matches[0].id };
  if (matches.length > 1) return { status: 'ambiguous' };
  return { status: 'new' };
}

function projectExternalTransaction(row) {
  if (!row || row.pending) return null;
  const kind = row.transaction_kind;
  const purchase = kind === 'purchase';
  const amount = Number(row.amount);
  return {
    externalTransactionId: row.id,
    date: row.transaction_date,
    amount: purchase ? Math.abs(amount) : -Math.abs(amount),
    merchant: row.merchant_name || row.raw_description,
    originalMerchant: row.raw_description,
    description: '',
    transactionType: kind,
    isCredit: !purchase,
    providerTransactionId: row.provider_transaction_id,
    lifecycleStatus: row.lifecycle_status
  };
}

function reconcileImportedChange(importSnapshot, currentTransaction, options = {}) {
  if (options.removed) return { status: 'conflicted' };
  const fields = ['date', 'amount', 'merchant', 'transactionType'];
  return fields.every(field => currentTransaction[field] === importSnapshot[field])
    ? { status: 'safe_update' }
    : { status: 'conflicted' };
}

module.exports = { reconcileCandidate, projectExternalTransaction, reconcileImportedChange, normalizeMerchant };
