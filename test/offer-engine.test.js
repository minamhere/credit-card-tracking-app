const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../offer-engine');

const transactions = [
    { date: '2026-09-01', amount: 941.08, merchant: 'Mixed purchases', categories: ['grocery'], transactionType: 'purchase' },
    { date: '2026-09-02', amount: 180.60, merchant: 'More purchases', categories: ['retail'], transactionType: 'purchase' },
    { date: '2026-09-03', amount: 3.32, merchant: 'Tokyo Joes', categories: ['restaurant'], transactionType: 'purchase' }
];

test('percentage offer applies activation threshold and reward cap', () => {
    const offer = {
        startDate: '2026-09-01', endDate: '2026-09-30',
        eligibility: { transactionTypes: ['purchase'], includeCategories: [], excludeCategories: [] },
        measurement: { kind: 'spend', period: 'offer' },
        rewardConfig: { kind: 'percentage', rate: 8, activationThreshold: 900, cap: 90 },
        credits: [{ amount: 75.29 }, { amount: 14.44 }, { amount: 0.27 }]
    };
    const result = engine.calculateOfferProgress(offer, transactions, { asOf: '2026-09-10' });
    assert.equal(result.totalSpending, 1125);
    assert.equal(result.expectedReward, 90);
    assert.equal(result.postedCredits, 90);
    assert.equal(result.outstandingReward, 0);
    assert.equal(result.completed, true);
});

test('tier offer includes selected categories and excludes entertainment', () => {
    const offer = {
        startDate: '2026-09-01', endDate: '2026-09-30',
        eligibility: { transactionTypes: ['purchase'], includeCategories: ['gas', 'grocery', 'restaurant'], excludeCategories: [] },
        measurement: { kind: 'spend', period: 'offer' },
        rewardConfig: { kind: 'tiers', tiers: [{ threshold: 1000, reward: 80 }, { threshold: 2000, reward: 160 }] }
    };
    const rows = [
        { date: '2026-09-02', amount: 950, merchant: 'Grocery', categories: ['grocery'], transactionType: 'purchase' },
        { date: '2026-09-03', amount: 60, merchant: 'Lost Island', categories: ['entertainment'], transactionType: 'purchase' },
        { date: '2026-09-04', amount: 50, merchant: 'Restaurant', categories: ['restaurant'], transactionType: 'purchase' }
    ];
    const result = engine.calculateOfferProgress(offer, rows, { asOf: '2026-09-10' });
    assert.equal(result.totalSpending, 1000);
    assert.equal(result.expectedReward, 80);
    assert.equal(result.excludedTransactions[0].merchant, 'Lost Island');
    assert.equal(result.nextTarget, 2000);
});

test('same transaction can qualify for independent stacked offers', () => {
    const transaction = { date: '2026-09-10', amount: 100, merchant: 'Target', categories: ['retail'], transactionType: 'purchase' };
    const broad = { startDate: '2026-09-01', endDate: '2026-09-30', eligibility: { transactionTypes: ['purchase'] } };
    const retail = { ...broad, eligibility: { transactionTypes: ['purchase'], includeCategories: ['retail'] } };
    assert.equal(engine.evaluateEligibility(transaction, broad).eligible, true);
    assert.equal(engine.evaluateEligibility(transaction, retail).eligible, true);
});
