const test = require('node:test');
const assert = require('node:assert/strict');
const { purchaseMatches, findPurchaseMatches } = require('../purchase-reconciliation');
const { buildRepairPlan } = require('../repair-plaid-duplicates');
const candidate = { personId: 7, date: '2026-09-06', amount: 9.7, merchant: 'Stadium Concessions', rawMerchant: 'STADIUM GENER', external: true };
const original = { id: 31, person_id: 7, date: '2026-09-06', amount: '9.70', merchant: 'Stadium Concessions', raw_merchant: 'STADIUM GENER   CITY CO', transaction_type: 'purchase', source: 'citi_csv', categories: ['restaurant'] };
const transaction = { ...original, id: 40, source: 'plaid', raw_merchant: candidate.rawMerchant, categories: ['general'] };
const external = { id: 1, linked_transaction_id: 40, lifecycle_status: 'imported', transaction_kind: 'purchase', transaction_date: transaction.date, amount: transaction.amount, raw_description: transaction.raw_merchant, pending: false };

test('matches unique same-day display names despite truncated location descriptions', () => {
  assert.equal(purchaseMatches(candidate, original), true);
  assert.equal(purchaseMatches({ ...candidate, rawMerchant: 'Completely different bank description' }, original), true);
});
test('normalizes whitespace for both raw descriptions and display names', () => {
  assert.equal(purchaseMatches({ ...candidate, rawMerchant: 'STADIUM GENER CITY CO', merchant: 'Unmapped' }, original), true);
  assert.equal(purchaseMatches({ ...candidate, merchant: ' stadium   concessions ' }, original), true);
});
test('display-name fallback cannot match a different date, person, amount, type, or merchant', () => {
  for (const change of [{ date: '2026-09-07' }, { person_id: 8 }, { amount: 10 }, { transaction_type: 'refund' }, { merchant: 'Other Shop' }]) {
    assert.equal(purchaseMatches(candidate, { ...original, ...change }), false);
  }
});
test('exact raw descriptions retain the three-day posted-date allowance', () => {
  assert.equal(purchaseMatches({ ...candidate, rawMerchant: original.raw_merchant }, { ...original, date: '2026-09-09' }), true);
  assert.equal(purchaseMatches({ ...candidate, rawMerchant: original.raw_merchant }, { ...original, date: '2026-09-10' }), false);
});
test('does not truncate candidate queries before checking merchant uniqueness', async () => {
  const matches = await findPurchaseMatches({ query: async sql => {
    assert.doesNotMatch(sql, /LIMIT/);
    return { rows: [original, { ...original, id: 32 }, { ...original, id: 33, merchant: 'Other' }] };
  } }, candidate);
  assert.deepEqual(matches.map(row => row.id), [31, 32]);
});
test('repair preserves original categories and requires mutual one-to-one matching', () => {
  const plan = buildRepairPlan([{ transaction, external }], [original]);
  assert.equal(plan.pairs.length, 1);
  assert.deepEqual(plan.pairs[0].original.categories, ['restaurant']);
  assert.equal(buildRepairPlan([{ transaction, external }], [original, { ...original, id: 32 }]).pairs.length, 0);
  assert.equal(buildRepairPlan([{ transaction, external }, { transaction: { ...transaction, id: 41 }, external }], [original]).pairs.length, 0);
});
test('repair ignores modified, pending, conflicted, and non-purchase provider rows', () => {
  for (const change of [{ lifecycle_status: 'conflicted' }, { pending: true }, { amount: 99 }, { transaction_kind: 'credit' }, { raw_description: 'Changed' }]) {
    assert.equal(buildRepairPlan([{ transaction, external: { ...external, ...change } }], [original]).pairs.length, 0);
  }
});
test('repair approval token changes if either snapshot changes', () => {
  const before = buildRepairPlan([{ transaction, external }], [original]);
  const after = buildRepairPlan([{ transaction, external }], [{ ...original, categories: ['retail'] }]);
  assert.notEqual(before.token, after.token);
});
