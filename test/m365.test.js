const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMessage } = require('../m365');

const forwardedMessage = (subject, body) => ({
    subject,
    from: { emailAddress: { address: 'chris@yither.com' } },
    body: { contentType: 'html', content: body }
});

test('recognizes a forwarded Citi progress email as an offer reminder', () => {
    const result = classifyMessage(forwardedMessage('FW: You have already activated this offer', `
        <p>From: Citi &lt;citi@info15.citi.com&gt;</p>
        <p>Citi ThankYou Mastercard</p>
        <p>Earn 8% back in statement credits (up to $90 each month) on eligible purchases.</p>
        <p>Spend $900 or more each month from 8/1/2026 through 10/31/2026.</p>
        <p>Security Zone: Christopher Nolan</p><p>Account ending in: 1886</p>
    `));
    assert.equal(result.classification, 'offer_reminder');
    assert.equal(result.status, 'review');
    assert.equal(result.parsedOffer.percentBack, 8);
    assert.equal(result.parsedOffer.minSpendThreshold, 900);
});

test('ignores a forwarded Citi promotional APR email', () => {
    const result = classifyMessage(forwardedMessage('FW: Promotional APR', `
        <p>From: Citi &lt;citi@info15.citi.com&gt;</p>
        <p>Enjoy a promotional APR on eligible purchases.</p>
    `));
    assert.equal(result.classification, 'non_offer');
    assert.equal(result.status, 'ignored');
    assert.equal(result.parsedOffer, null);
});

test('offer terms take priority over incidental APR boilerplate', () => {
    const result = classifyMessage(forwardedMessage(
        "Fw: Christopher, you've activated – now earn back a statement credit (after you make qualifying spend)!",
        `<p>From: Citi &lt;citi@info15.citi.com&gt;</p>
         <p>Citi ThankYou Mastercard</p>
         <p>Earn a $80 statement credit when you spend $1,000 each month on eligible gas station, grocery store and restaurant purchases.</p>
         <p>Only purchases made from 1/1/2026 through 12/31/2026 qualify.</p>
         <p>Annual Percentage Rate information may be found in your card agreement.</p>
         <p>Security Zone: Christopher Nolan</p><p>Account ending in: 1886</p>`
    ));
    assert.equal(result.classification, 'offer_reminder');
    assert.equal(result.status, 'review');
    assert.equal(result.parsedOffer.tiers[0].reward, 80);
});

test('ignores unrelated forwarded mail', () => {
    const result = classifyMessage(forwardedMessage('FW: Weekly newsletter', '<p>Here are this week’s updates.</p>'));
    assert.equal(result.classification, 'non_citi');
    assert.equal(result.status, 'ignored');
});
