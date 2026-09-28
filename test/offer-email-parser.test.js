const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOfferEmail } = require('../offer-email-parser');

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
