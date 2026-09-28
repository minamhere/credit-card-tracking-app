const test = require('node:test');
const assert = require('node:assert/strict');
const { offerFingerprint, parseOfferEmail } = require('../offer-email-parser');

test('parses Citi monthly retail percentage offer', () => {
    const result = parseOfferEmail(`
      Earn 5% back in statement credits up to a maximum total of $80 each month
      For total eligible retail purchases made each month from 1/1/2026 (or the date you activate this offer, whichever is later) through 12/31/2026.
      Security Zone: Christopher Nolan
      Account ending in: 1886
      Purchases not eligible for this offer include purchases made at home improvement stores, wholesale clubs, grocery stores or special events.
    `);
    assert.equal(result.type, 'percent-back');
    assert.equal(result.percentBack, 5);
    assert.equal(result.maxBack, 80);
    assert.equal(result.monthlyTracking, true);
    assert.equal(result.startDate, '2026-01-01');
    assert.equal(result.endDate, '2026-12-31');
    assert.deepEqual(result.categories, ['retail']);
    assert.deepEqual(result.excludeCategories, ['home-improvement', 'wholesale-club', 'grocery', 'special-event']);
    assert.equal(result.ownerName, 'Christopher Nolan');
    assert.equal(result.accountLastFour, '1886');
    assert.equal(result.warnings.length, 1);
});

test('parses monthly gas grocery and restaurant reward tiers', () => {
    const result = parseOfferEmail(`
      Eligible gas station, grocery store and restaurant purchases can earn back a statement credit through 12/31/2026.
      Each month you can earn back a:
      $80 statement credit when you spend $1,000 – $1,999.99 each month on total eligible gas station, grocery store and restaurant purchases
      OR
      $160 statement credit when you spend $2,000 or more each month on total eligible gas station, grocery store and restaurant purchases.
      Only purchases made from 1/1/2026 (or the date you activate this offer, whichever is later) through 12/31/2026 qualify.
      Security Zone: Christopher Nolan
      Account ending in: 1886
    `);
    assert.equal(result.type, 'spending');
    assert.equal(result.monthlyTracking, true);
    assert.deepEqual(result.categories, ['gas', 'grocery', 'restaurant']);
    assert.deepEqual(result.tiers, [
        { threshold: 1000, reward: 80 },
        { threshold: 2000, reward: 160 }
    ]);
    assert.equal(result.spendingTarget, 2000);
    assert.equal(result.startDate, '2026-01-01');
    assert.equal(result.endDate, '2026-12-31');
    assert.equal(result.warnings.length, 1);
});

test('parses broad monthly percentage offer without mistaking base points for offer categories', () => {
    const result = parseOfferEmail(`
      Earn 8% back in statement credits (up to $90 each month) on eligible purchases until 10/31/2026.
      Spend $900 or more each month on total eligible purchases from 8/1/2026 (or the date you activated this offer, whichever is later) through 10/31/2026 to earn 8% back in statement credits each month.
      You'll also earn 5 Points for gas station purchases, 3 Points for restaurant and grocery store purchases, and 2 Points at department stores.
      Security Zone: Christopher Nolan
      Account ending in: 1886
    `);
    assert.equal(result.type, 'percent-back');
    assert.equal(result.percentBack, 8);
    assert.equal(result.maxBack, 90);
    assert.equal(result.minSpendThreshold, 900);
    assert.equal(result.monthlyTracking, true);
    assert.deepEqual(result.categories, []);
    assert.equal(result.name, '8% Qualifying Purchases');
    assert.equal(result.startDate, '2026-08-01');
    assert.equal(result.endDate, '2026-10-31');
    assert.equal(result.warnings.length, 1);
});

test('fingerprints repeated lifecycle emails as the same offer', () => {
    const invitation = parseOfferEmail(`Earn 8% back (up to $90 each month) on eligible purchases. Spend $900 or more each month from 8/1/2026 (or the date you activate this offer, whichever is later) through 10/31/2026. Account ending in: 1886`);
    const progress = parseOfferEmail(`Earn 8% back in statement credits (up to $90 each month) on eligible purchases. You have activated. Spend $900 or more each month from 8/1/2026 (or the date you activated this offer, whichever is later) through 10/31/2026. Account ending in: 1886`);
    assert.equal(invitation.fingerprint, progress.fingerprint);
    assert.equal(invitation.fingerprint, offerFingerprint(progress));
});
