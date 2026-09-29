const test = require('node:test');
const assert = require('node:assert/strict');
const { findCreditMatch, isPotentialOfferCredit, percentageCheckpointDetails, percentagePurchaseDetails } = require('../credit-matcher');

const event = { date: '2026-09-12', amount: -75.29, description: 'Statement Credit', eventType: 'specific credit amount adjustment' };

test('matches a statement credit to the unique exact outstanding offer', () => {
    const result = findCreditMatch(event, [
        { offer: { id: 1, name: '8% offer', startDate: '2026-08-01', endDate: '2026-10-31', rewardConfig: { kind: 'percentage', rate: 8, cap: 90 } }, progress: { expectedReward: 75.29, postedCredits: 0 } },
        { offer: { id: 2, name: 'Retail', startDate: '2026-01-01', endDate: '2026-12-31', rewardConfig: { kind: 'percentage', rate: 5, cap: 80 } }, progress: { expectedReward: 0, postedCredits: 0 } }
    ]);
    assert.equal(result.matched, true);
    assert.equal(result.offerId, 1);
});

test('leaves equal candidates unassigned', () => {
    const candidates = [1, 2].map(id => ({
        offer: { id, name: `Offer ${id}`, startDate: '2026-01-01', endDate: '2026-12-31', rewardConfig: { kind: 'fixed' } },
        progress: { expectedReward: 75.29, postedCredits: 0 }
    }));
    assert.equal(findCreditMatch(event, candidates).matched, false);
});

test('matches a backdated percentage credit to an earlier spend checkpoint', () => {
    const result = findCreditMatch(
        { ...event, date: '2026-09-01' },
        [{
            offer: {
                id: 1, name: '8% offer', startDate: '2026-08-01', endDate: '2026-10-31',
                measurement: { period: 'monthly' },
                rewardConfig: { kind: 'percentage', rate: 8, activationThreshold: 900, cap: 90 }
            },
            progress: {
                expectedReward: 89.73,
                postedCredits: 0,
                eligibleTransactions: [
                    { id: 1, date: '2026-09-11', amount: 853.68 },
                    { id: 2, date: '2026-09-12', amount: 87.40 },
                    { id: 3, date: '2026-09-20', amount: 180.60 }
                ]
            }
        }]
    );
    assert.equal(result.matched, true);
    assert.equal(result.offerId, 1);
    assert.match(result.reasons[0], /checkpoint/);
});

test('explains the transaction and spend behind a percentage checkpoint', () => {
    const checkpoints = percentageCheckpointDetails(
        { measurement: { period: 'monthly' }, rewardConfig: { kind: 'percentage', rate: 8, activationThreshold: 900, cap: 90 } },
        { postedCredits: 0, eligibleTransactions: [
            { id: 1, date: '2026-09-11', amount: 853.68, merchant: 'Chilis' },
            { id: 2, date: '2026-09-12', amount: 87.40, merchant: 'King Soopers' }
        ] }
    );
    assert.equal(checkpoints[1].amount, 75.29);
    assert.equal(checkpoints[1].qualifyingSpend, 941.08);
    assert.equal(checkpoints[1].transaction.merchant, 'King Soopers');
});

test('matches an incremental percentage credit after an earlier credit posts', () => {
    const result = findCreditMatch(
        { ...event, amount: -14.44 },
        [{
            offer: {
                id: 1, name: '8% offer', measurement: { period: 'monthly' },
                rewardConfig: { kind: 'percentage', rate: 8, activationThreshold: 900, cap: 90 }
            },
            progress: {
                expectedReward: 89.73,
                postedCredits: 75.29,
                eligibleTransactions: [
                    { id: 1, date: '2026-09-11', amount: 853.68 },
                    { id: 2, date: '2026-09-12', amount: 87.40 },
                    { id: 3, date: '2026-09-20', amount: 180.60 }
                ]
            }
        }]
    );
    assert.equal(result.matched, true);
    assert.equal(result.offerId, 1);
});

test('matches 5% credit to a single qualifying retail purchase', () => {
    const result = findCreditMatch(
        { ...event, amount: -3.31 },
        [{
            offer: { id: 5, name: '5% retail', measurement: { period: 'monthly' }, rewardConfig: { kind: 'percentage', rate: 5, activationThreshold: 0, cap: 80 } },
            progress: { expectedReward: 3.31, postedCredits: 0, eligibleTransactions: [{ id: 10, date: '2026-09-27', amount: 66.18, merchant: 'Target' }] }
        }]
    );
    assert.equal(result.matched, true);
    assert.equal(result.offerId, 5);
});

test('matches 5% credit to a day of qualifying retail purchases', () => {
    const progress = { expectedReward: 7.50, postedCredits: 0, eligibleTransactions: [
        { id: 10, date: '2026-09-27', amount: 60, merchant: 'Target' },
        { id: 11, date: '2026-09-27', amount: 90, merchant: 'TJ Maxx' }
    ] };
    const details = percentagePurchaseDetails(
        { measurement: { period: 'monthly' }, rewardConfig: { kind: 'percentage', rate: 5, activationThreshold: 0, cap: 80 } },
        progress
    );
    assert.ok(details.some(detail => detail.kind === 'day' && detail.amount === 7.50 && detail.qualifyingSpend === 150));
    const result = findCreditMatch({ ...event, amount: -7.50 }, [{
        offer: { id: 5, name: '5% retail', measurement: { period: 'monthly' }, rewardConfig: { kind: 'percentage', rate: 5, activationThreshold: 0, cap: 80 } },
        progress
    }]);
    assert.equal(result.matched, true);
});

test('does not treat card payments as offer credits', () => {
    assert.equal(isPotentialOfferCredit({ description: 'AUTOPAY PAYMENT THANK YOU', eventType: 'payment' }), false);
});
