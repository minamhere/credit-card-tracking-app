const test = require('node:test');
const assert = require('node:assert/strict');

function fakeSdk(overrides = {}) {
  const calls = [];
  const api = {
    linkTokenCreate: async request => ({ data: { link_token: 'link-token', expiration: '2030-01-01', request_id: 'req-link' } }),
    itemPublicTokenExchange: async request => ({ data: { access_token: 'access-token', item_id: 'item-id', request_id: 'req-exchange' } }),
    accountsGet: async request => ({ data: { accounts: [], request_id: 'req-accounts' } }),
    itemGet: async request => ({ data: { item: { item_id: 'item-id' }, status: {}, request_id: 'req-item' } }),
    itemRemove: async request => ({ data: { removed: true, request_id: 'req-remove' } }),
    ...overrides
  };
  for (const name of Object.keys(api)) {
    const original = api[name];
    api[name] = async request => { calls.push([name, request]); return original(request); };
  }
  class Configuration { constructor(options) { this.options = options; } }
  class PlaidApi { constructor(configuration) { calls.push(['configuration', configuration.options]); return api; } }
  return { module: { Configuration, PlaidApi, PlaidEnvironments: { sandbox: 'sandbox-url', production: 'production-url' } }, calls };
}

const config = { clientId: 'client-id', secret: 'super-secret', environment: 'sandbox' };

test('creates a transactions Link token without webhook, redirect, or PII', async () => {
  const { createPlaidClient } = require('../plaid-client');
  const fake = fakeSdk();
  const client = createPlaidClient(config, fake.module);
  const result = await client.createLinkToken(42);

  assert.equal(result.linkToken, 'link-token');
  const configuration = fake.calls.find(([name]) => name === 'configuration')[1];
  assert.equal(configuration.basePath, 'sandbox-url');
  assert.equal(configuration.baseOptions.headers['PLAID-CLIENT-ID'], 'client-id');
  assert.equal(configuration.baseOptions.headers['PLAID-SECRET'], 'super-secret');
  const request = fake.calls.find(([name]) => name === 'linkTokenCreate')[1];
  assert.deepEqual(request.products, ['transactions']);
  assert.deepEqual(request.transactions, { days_requested: 60 });
  assert.deepEqual(request.country_codes, ['US']);
  assert.equal(request.user.client_user_id, 'person-42');
  assert.equal(request.client_name, 'Credit Card Offer Tracker');
  assert.equal('webhook' in request, false);
  assert.equal('redirect_uri' in request, false);
});

test('maps exchange, account, item, and removal responses to minimal objects', async () => {
  const { createPlaidClient } = require('../plaid-client');
  const fake = fakeSdk({
    accountsGet: async () => ({ data: { request_id: 'req-a', accounts: [{ account_id: 'acct-1', name: 'Citi Card', official_name: 'Citi Rewards', type: 'credit', subtype: 'credit card', mask: '1234', persistent_account_id: 'persistent-1', balances: { current: 50 } }] } }),
    itemGet: async () => ({ data: { request_id: 'req-i', item: { item_id: 'item-id', consent_expiration_time: '2030-01-01T00:00:00Z' }, status: { transactions: { last_successful_update: '2029-01-01T00:00:00Z' } } } })
  });
  const client = createPlaidClient(config, fake.module);

  assert.deepEqual(await client.exchangePublicToken('public-token'), { accessToken: 'access-token', itemId: 'item-id', requestId: 'req-exchange' });
  assert.deepEqual(await client.getAccounts('access-token'), [{ accountId: 'acct-1', name: 'Citi Card', officialName: 'Citi Rewards', type: 'credit', subtype: 'credit card', mask: '1234', persistentAccountId: 'persistent-1' }]);
  assert.deepEqual(await client.getItem('access-token'), { itemId: 'item-id', consentExpirationTime: '2030-01-01T00:00:00Z', lastSuccessfulUpdate: '2029-01-01T00:00:00Z', requestId: 'req-i' });
  assert.deepEqual(await client.removeItem('access-token'), { removed: true, requestId: 'req-remove' });
});

test('converts Plaid failures to safe errors containing only operational identifiers', async () => {
  const { createPlaidClient } = require('../plaid-client');
  const secretToken = 'access-token-that-must-not-leak';
  const fake = fakeSdk({
    accountsGet: async () => {
      const error = new Error(`provider rejected ${secretToken}`);
      error.response = { data: { error_code: 'ITEM_LOGIN_REQUIRED', request_id: 'request-123', error_message: `bad ${secretToken}` } };
      throw error;
    }
  });
  const client = createPlaidClient(config, fake.module);

  await assert.rejects(client.getAccounts(secretToken), error => {
    assert.equal(error.code, 'ITEM_LOGIN_REQUIRED');
    assert.equal(error.requestId, 'request-123');
    assert.equal(error.message.includes(secretToken), false);
    assert.equal(JSON.stringify(error).includes(secretToken), false);
    return true;
  });
});

test('maps incremental transaction sync pages without exposing the access token', async () => {
  const { createPlaidClient } = require('../plaid-client');
  const fake = fakeSdk({
    transactionsSync: async request => ({ data: {
      added: [{ transaction_id: 'added-1' }], modified: [{ transaction_id: 'modified-1' }],
      removed: [{ transaction_id: 'removed-1' }], next_cursor: 'cursor-2', has_more: true,
      request_id: 'req-sync'
    } })
  });
  const client = createPlaidClient(config, fake.module);
  assert.deepEqual(await client.syncTransactions('access-secret', 'cursor-1'), {
    added: [{ transaction_id: 'added-1' }], modified: [{ transaction_id: 'modified-1' }],
    removed: [{ transaction_id: 'removed-1' }], nextCursor: 'cursor-2', hasMore: true, requestId: 'req-sync'
  });
  const request = fake.calls.find(([name]) => name === 'transactionsSync')[1];
  assert.deepEqual(request, { access_token: 'access-secret', cursor: 'cursor-1', count: 500 });
});

test('creates an update-mode Link token without requesting products or exchanging a token', async () => {
  const { createPlaidClient } = require('../plaid-client');
  const fake = fakeSdk();
  const client = createPlaidClient(config, fake.module);
  const result = await client.createUpdateLinkToken('access-secret', 42);
  assert.equal(result.linkToken, 'link-token');
  const request = fake.calls.find(([name]) => name === 'linkTokenCreate')[1];
  assert.equal(request.access_token, 'access-secret');
  assert.equal(request.user.client_user_id, 'person-42');
  assert.equal('products' in request, false);
  assert.equal('transactions' in request, false);
  assert.equal(fake.calls.some(([name]) => name === 'itemPublicTokenExchange'), false);
});
