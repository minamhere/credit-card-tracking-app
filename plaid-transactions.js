function invalid() {
  throw new Error('Invalid Plaid transaction record.');
}

function classify(raw) {
  const description = `${raw.name || ''} ${raw.merchant_name || ''}`.toUpperCase();
  const category = `${raw.personal_finance_category?.primary || ''} ${raw.personal_finance_category?.detailed || ''}`.toUpperCase();
  if (/INTEREST/.test(description) || /INTEREST/.test(category)) return 'interest';
  if (/\bFEE\b/.test(description) || /BANK_FEES/.test(category)) return 'fee';
  if (/PAYMENT|AUTOPAY|THANK YOU/.test(description) || /LOAN_PAYMENTS/.test(category)) return 'payment';
  if (raw.amount < 0 && /REFUND|RETURN/.test(description)) return 'refund';
  if (raw.amount < 0) return 'credit';
  return 'purchase';
}

function normalizePlaidTransaction(raw) {
  if (!raw || typeof raw.transaction_id !== 'string' || !raw.transaction_id ||
      typeof raw.account_id !== 'string' || !raw.account_id ||
      !/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') ||
      typeof raw.amount !== 'number' || !Number.isFinite(raw.amount) ||
      typeof raw.name !== 'string' || !raw.name.trim()) invalid();
  if (raw.authorized_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(raw.authorized_date)) invalid();

  return {
    providerTransactionId: raw.transaction_id,
    providerAccountId: raw.account_id,
    pendingProviderTransactionId: raw.pending_transaction_id || null,
    pending: Boolean(raw.pending),
    date: raw.date,
    authorizedDate: raw.authorized_date || null,
    amount: raw.amount,
    rawDescription: raw.name.trim(),
    merchantName: String(raw.merchant_name || raw.name).trim(),
    providerCategory: raw.personal_finance_category?.detailed || raw.personal_finance_category?.primary || null,
    transactionKind: classify(raw),
    rawPayload: raw
  };
}

module.exports = { normalizePlaidTransaction };
