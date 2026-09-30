const test = require('node:test');
const assert = require('node:assert/strict');

const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

test('renders a connect prompt when no card is connected', () => {
  const { renderPlaidConnections } = require('../plaid-ui');
  const html = renderPlaidConnections([], escapeHtml);
  assert.match(html, /Connect Citi/);
  assert.doesNotMatch(html, /Sync now|Disconnect/);
});

test('renders selected card mask, sync health, review count, and actions safely', () => {
  const { renderPlaidConnections } = require('../plaid-ui');
  const html = renderPlaidConnections([{
    id: 12, status: 'healthy', lastAttemptAt: '2026-09-29T10:00:00Z', lastSuccessAt: '2026-09-29T09:00:00Z',
    reviewCount: 3, accounts: [
      { id: 21, name: '<Citi Card>', mask: '1234', selected: true },
      { id: 22, name: 'Irrelevant card', mask: '9999', selected: false }
    ]
  }], escapeHtml);
  assert.match(html, /&lt;Citi Card&gt;.*1234/);
  assert.match(html, /3 transactions awaiting review/);
  assert.match(html, /Last successful sync/);
  assert.match(html, /Sync now/);
  assert.match(html, /Review transactions/);
  assert.match(html, /Disconnect/);
  assert.match(html, /1 additional account is ignored/);
  assert.doesNotMatch(html, /access.?token|secret|ciphertext/i);
});

test('renders account selection with exactly one radio choice', () => {
  const { renderPlaidConnections } = require('../plaid-ui');
  const html = renderPlaidConnections([{ id: 12, status: 'account_selection', accounts: [
    { id: 21, name: 'Card A', mask: '1111', type: 'credit', subtype: 'credit card', selected: false },
    { id: 22, name: 'Checking', mask: '2222', type: 'depository', subtype: 'checking', selected: false }
  ] }], escapeHtml);
  assert.equal((html.match(/type="radio"/g) || []).length, 1);
  assert.match(html, /data-action="select-account"/);
});

test('renders reconnect only for attention-required connections', () => {
  const { renderPlaidConnections } = require('../plaid-ui');
  const html = renderPlaidConnections([{ id: 12, status: 'attention_required', lastErrorCode: 'ITEM_LOGIN_REQUIRED', accounts: [] }], escapeHtml);
  assert.match(html, /Reconnect/);
  assert.match(html, /needs attention/);
  assert.doesNotMatch(html, /Sync now/);
});
