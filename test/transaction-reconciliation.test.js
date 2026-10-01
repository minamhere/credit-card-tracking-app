const test = require('node:test');
const assert = require('node:assert/strict');

const candidate = {
  personId: 7, date: '2026-09-28', amount: 42.17, transactionType: 'purchase',
  rawMerchant: 'Grocery   Market #123', source: 'plaid', providerTransactionId: 'plaid-1'
};

test('matches an exact provider transaction id', () => {
  const { reconcileCandidate } = require('../transaction-reconciliation');
  assert.deepEqual(reconcileCandidate(candidate, [{ id: 9, personId: 7, providerTransactionId: 'plaid-1', source: 'plaid' }]), { status: 'duplicate', matchId: 9 });
});

test('matches a Plaid purchase to one CSV row within three days', () => {
  const { reconcileCandidate } = require('../transaction-reconciliation');
  const existing = [{ id: 10, personId: 7, date: '2026-09-26', amount: 42.17, transactionType: 'purchase', rawMerchant: ' grocery market #123 ', source: 'citi_csv' }];
  assert.deepEqual(reconcileCandidate(candidate, existing), { status: 'duplicate', matchId: 10 });
});

test('does not merge distinct Plaid provider ids with identical purchase details', () => {
  const { reconcileCandidate } = require('../transaction-reconciliation');
  const existing = [{ id: 10, ...candidate, providerTransactionId: 'plaid-2' }];
  assert.deepEqual(reconcileCandidate(candidate, existing), { status: 'new' });
});

test('keeps multiple cross-source candidates ambiguous', () => {
  const { reconcileCandidate } = require('../transaction-reconciliation');
  const row = { personId: 7, date: '2026-09-28', amount: 42.17, transactionType: 'purchase', rawMerchant: 'GROCERY MARKET #123', source: 'citi_csv' };
  assert.deepEqual(reconcileCandidate(candidate, [{ id: 10, ...row }, { id: 11, ...row }]), { status: 'ambiguous' });
});

test('does not match another cardholder, distant date, type, amount, or merchant', () => {
  const { reconcileCandidate } = require('../transaction-reconciliation');
  const mismatches = [
    { id: 1, personId: 8, date: '2026-09-28', amount: 42.17, transactionType: 'purchase', rawMerchant: 'Grocery Market #123' },
    { id: 2, personId: 7, date: '2026-09-24', amount: 42.17, transactionType: 'purchase', rawMerchant: 'Grocery Market #123' },
    { id: 3, personId: 7, date: '2026-09-28', amount: 42.18, transactionType: 'purchase', rawMerchant: 'Grocery Market #123' },
    { id: 4, personId: 7, date: '2026-09-28', amount: 42.17, transactionType: 'refund', rawMerchant: 'Grocery Market #123' },
    { id: 5, personId: 7, date: '2026-09-28', amount: 42.17, transactionType: 'purchase', rawMerchant: 'Different' }
  ];
  assert.deepEqual(reconcileCandidate(candidate, mismatches), { status: 'new' });
});

test('projects only posted records and converts application amount conventions', () => {
  const { projectExternalTransaction } = require('../transaction-reconciliation');
  assert.equal(projectExternalTransaction({ pending: true }), null);
  assert.deepEqual(projectExternalTransaction({
    id: 5, pending: false, transaction_date: '2026-09-28', authorized_date: null,
    amount: '42.17', raw_description: 'STORE 123', merchant_name: 'Store', transaction_kind: 'purchase',
    provider_transaction_id: 'plaid-1', lifecycle_status: 'awaiting_review'
  }), {
    externalTransactionId: 5, date: '2026-09-28', amount: 42.17, merchant: 'Store',
    originalMerchant: 'STORE 123', description: '', transactionType: 'purchase', isCredit: false,
    providerTransactionId: 'plaid-1', lifecycleStatus: 'awaiting_review'
  });
  const payment = projectExternalTransaction({
    id: 6, pending: false, transaction_date: '2026-09-28', amount: '-500', raw_description: 'AUTOPAY',
    merchant_name: 'AUTOPAY', transaction_kind: 'payment', provider_transaction_id: 'plaid-2', lifecycle_status: 'awaiting_review'
  });
  assert.equal(payment.amount, -500);
  assert.equal(payment.isCredit, true);
});

test('projects PostgreSQL DATE values as calendar dates instead of timestamps', () => {
  const { projectExternalTransaction } = require('../transaction-reconciliation');
  const projected = projectExternalTransaction({
    id: 5, pending: false, transaction_date: new Date(2026, 8, 28), amount: '42.17',
    raw_description: 'STORE', merchant_name: 'Store', transaction_kind: 'purchase',
    provider_transaction_id: 'plaid-1', lifecycle_status: 'awaiting_review', updated_at: new Date('2026-09-29T12:00:00Z')
  });
  assert.equal(projected.date, '2026-09-28');
  assert.equal(projected.externalUpdatedAt, '2026-09-29T12:00:00.000Z');
});

test('decides whether provider changes may update an imported row', () => {
  const { reconcileImportedChange } = require('../transaction-reconciliation');
  const snapshot = { date: '2026-09-28', amount: 42.17, merchant: 'Store', transactionType: 'purchase' };
  assert.deepEqual(reconcileImportedChange(snapshot, snapshot), { status: 'safe_update' });
  assert.deepEqual(reconcileImportedChange(snapshot, { ...snapshot, merchant: 'My edited store' }), { status: 'conflicted' });
  assert.deepEqual(reconcileImportedChange(snapshot, snapshot, { removed: true }), { status: 'conflicted' });
});

test('allocates a cross-source match to only one repeated occurrence', () => {
  const { claimUniqueMatch } = require('../transaction-reconciliation');
  const claimed = new Set();
  assert.deepEqual(claimUniqueMatch([{ id: 12 }], claimed).status, 'duplicate');
  assert.deepEqual(claimUniqueMatch([{ id: 12 }], claimed).status, 'new');
  assert.equal(claimed.has(12), true);
  assert.equal(claimUniqueMatch([{ id: 13 }, { id: 14 }], claimed).status, 'ambiguous');
});
