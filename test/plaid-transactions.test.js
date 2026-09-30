const test = require('node:test');
const assert = require('node:assert/strict');

function base(overrides = {}) {
  return {
    transaction_id: 'tx-1', account_id: 'account-1', date: '2026-09-28', authorized_date: '2026-09-27',
    amount: 42.17, name: 'GROCERY MARKET #123', merchant_name: 'Grocery Market', pending: false,
    pending_transaction_id: null, personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' },
    ...overrides
  };
}

test('normalizes a posted purchase while preserving Plaid amount and dates', () => {
  const { normalizePlaidTransaction } = require('../plaid-transactions');
  assert.deepEqual(normalizePlaidTransaction(base()), {
    providerTransactionId: 'tx-1', providerAccountId: 'account-1', pendingProviderTransactionId: null,
    pending: false, date: '2026-09-28', authorizedDate: '2026-09-27', amount: 42.17,
    rawDescription: 'GROCERY MARKET #123', merchantName: 'Grocery Market',
    providerCategory: 'FOOD_AND_DRINK_GROCERIES', transactionKind: 'purchase', rawPayload: base()
  });
});

test('preserves pending state and pending-to-posted relationship', () => {
  const { normalizePlaidTransaction } = require('../plaid-transactions');
  assert.equal(normalizePlaidTransaction(base({ pending: true })).pending, true);
  assert.equal(normalizePlaidTransaction(base({ transaction_id: 'posted-1', pending_transaction_id: 'pending-1' })).pendingProviderTransactionId, 'pending-1');
});

test('classifies payments, refunds, credits, interest, and fees', () => {
  const { normalizePlaidTransaction } = require('../plaid-transactions');
  assert.equal(normalizePlaidTransaction(base({ amount: -500, name: 'AUTOPAY PAYMENT THANK YOU', merchant_name: null })).transactionKind, 'payment');
  assert.equal(normalizePlaidTransaction(base({ amount: -12.5, name: 'MERCHANT REFUND', merchant_name: 'Merchant' })).transactionKind, 'refund');
  assert.equal(normalizePlaidTransaction(base({ amount: -8, name: 'STATEMENT CREDIT', merchant_name: null })).transactionKind, 'credit');
  assert.equal(normalizePlaidTransaction(base({ amount: 14, name: 'INTEREST CHARGE ON PURCHASES', merchant_name: null })).transactionKind, 'interest');
  assert.equal(normalizePlaidTransaction(base({ amount: 25, name: 'LATE FEE', merchant_name: null })).transactionKind, 'fee');
});

test('uses the raw description when merchant name is absent', () => {
  const { normalizePlaidTransaction } = require('../plaid-transactions');
  const result = normalizePlaidTransaction(base({ merchant_name: null, name: 'LOCAL SHOP' }));
  assert.equal(result.merchantName, 'LOCAL SHOP');
  assert.equal(result.rawDescription, 'LOCAL SHOP');
});

test('rejects malformed provider records', () => {
  const { normalizePlaidTransaction } = require('../plaid-transactions');
  for (const invalid of [
    base({ transaction_id: '' }), base({ account_id: '' }), base({ date: '09/28/2026' }),
    base({ amount: '42.17' }), base({ amount: Number.NaN }), base({ name: '' })
  ]) assert.throws(() => normalizePlaidTransaction(invalid), /Invalid Plaid transaction/);
});
