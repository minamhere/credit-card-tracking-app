const test = require('node:test');
const assert = require('node:assert/strict');

const config = {
  environment: 'sandbox',
  tokenEncryptionKey: Buffer.alloc(32, 8)
};

function scriptedPool(results) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (!results.length) throw new Error(`Unexpected query: ${sql}`);
      const next = results.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(sql, params) : next;
    },
    release() { calls.push({ sql: 'RELEASE', params: [] }); }
  };
  return { calls, query: client.query, connect: async () => client };
}

function fakePlaid(accounts = []) {
  const calls = [];
  return {
    calls,
    async createLinkToken(personId) { calls.push(['createLinkToken', personId]); return { linkToken: 'link-token', expiration: '2030-01-01' }; },
    async createUpdateLinkToken(token, personId) { calls.push(['createUpdateLinkToken', token, personId]); return { linkToken: 'update-token', expiration: '2030-01-01' }; },
    async exchangePublicToken(token) { calls.push(['exchangePublicToken', token]); return { accessToken: 'access-secret', itemId: 'item-1' }; },
    async getAccounts(token) { calls.push(['getAccounts', token]); return accounts; },
    async getItem(token) { calls.push(['getItem', token]); return { consentExpirationTime: '2030-01-01T00:00:00Z' }; },
    async removeItem(token) { calls.push(['removeItem', token]); return { removed: true }; }
  };
}

test('requires an existing cardholder before creating a Link token', async () => {
  const { createConnectionService } = require('../plaid-connections');
  const pool = scriptedPool([{ rows: [] }]);
  const service = createConnectionService({ pool, plaidClient: fakePlaid(), config });
  await assert.rejects(service.createLinkToken(99), /Cardholder not found/);
});

test('creates a Link token for the selected cardholder', async () => {
  const { createConnectionService } = require('../plaid-connections');
  const plaid = fakePlaid();
  const service = createConnectionService({ pool: scriptedPool([{ rows: [{ id: 7 }] }]), plaidClient: plaid, config });
  const result = await service.createLinkToken(7);
  assert.equal(result.linkToken, 'link-token');
  assert.ok(result.linkSession);
  assert.deepEqual(plaid.calls, [['createLinkToken', 7]]);
});

test('binds Link completion to the initiating cardholder and expiration', () => {
  const { createLinkSession, verifyLinkSession } = require('../plaid-connections');
  const session = createLinkSession(7, config.tokenEncryptionKey, 1000);
  assert.doesNotThrow(() => verifyLinkSession(session, 7, config.tokenEncryptionKey, 2000));
  assert.throws(() => verifyLinkSession(session, 8, config.tokenEncryptionKey, 2000), /another cardholder/);
  assert.throws(() => verifyLinkSession(session, 7, config.tokenEncryptionKey, 16 * 60 * 1000), /expired/);
});

test('refuses a second Item while the cardholder already has an active connection', async () => {
  const { createConnectionService } = require('../plaid-connections');
  const service = createConnectionService({ pool: scriptedPool([{ rows: [{ id: 7, connection_status: 'healthy' }] }]), plaidClient: fakePlaid(), config });
  await assert.rejects(service.createLinkToken(7), /already has a Plaid connection/);
});

test('creates an update-mode Link token from the encrypted active connection', async () => {
  const { encryptAccessToken } = require('../plaid-token-crypto');
  const { createConnectionService } = require('../plaid-connections');
  const encrypted = encryptAccessToken('access-secret', config.tokenEncryptionKey, 'sandbox');
  const row = { id: 12, person_id: 7, financial_account_id: 22, provider_account_id: 'acct-1', sync_cursor: 'cursor', environment: 'sandbox', access_token_ciphertext: encrypted.ciphertext, access_token_nonce: encrypted.nonce, access_token_auth_tag: encrypted.authTag, access_token_key_version: encrypted.keyVersion };
  const plaid = fakePlaid();
  const service = createConnectionService({ pool: scriptedPool([{ rows: [row] }]), plaidClient: plaid, config });
  assert.deepEqual(await service.createUpdateLinkToken(7, 12), { linkToken: 'update-token', expiration: '2030-01-01' });
  assert.deepEqual(plaid.calls, [['createUpdateLinkToken', 'access-secret', 7]]);
});

test('exchanges a public token, encrypts access, and discovers all accounts unselected', async () => {
  const { createConnectionService, createLinkSession } = require('../plaid-connections');
  const accounts = [
    { accountId: 'credit-1', name: 'Citi Card', officialName: 'Rewards', type: 'credit', subtype: 'credit card', mask: '1234', persistentAccountId: 'p-1' },
    { accountId: 'deposit-1', name: 'Checking', officialName: null, type: 'depository', subtype: 'checking', mask: '9876', persistentAccountId: null }
  ];
  const pool = scriptedPool([
    { rows: [{ id: 7 }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [{ id: 12 }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] }
  ]);
  const service = createConnectionService({ pool, plaidClient: fakePlaid(accounts), config });
  const session = createLinkSession(7, config.tokenEncryptionKey);
  const result = await service.exchangeAndDiscover(7, 'public-token', session);

  assert.equal(result.connection.id, 12);
  assert.equal(result.connection.status, 'account_selection');
  assert.equal(result.accounts.length, 2);
  assert.ok(result.accounts.every(account => account.selected === false));
  assert.equal(JSON.stringify(result).includes('access-secret'), false);
  const insertConnection = pool.calls.find(call => call.sql.includes('INSERT INTO financial_connections'));
  assert.equal(insertConnection.params.includes('access-secret'), false);
  assert.equal(insertConnection.params[1], 'item-1');
  assert.ok(insertConnection.sql.includes('import_start_date = EXCLUDED.import_start_date'));
  assert.ok(insertConnection.params[3].length > 10);
});

test('rejects selecting an account owned by another connection or cardholder', async () => {
  const { createConnectionService } = require('../plaid-connections');
  const pool = scriptedPool([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
  const service = createConnectionService({ pool, plaidClient: fakePlaid(), config });
  await assert.rejects(service.selectAccount(7, 12, 99), /Account not found/);
  assert.ok(pool.calls.some(call => call.sql === 'ROLLBACK'));
});

test('selects exactly one credit-card account and activates the connection', async () => {
  const { createConnectionService } = require('../plaid-connections');
  const pool = scriptedPool([
    { rows: [] },
    { rows: [] },
    { rows: [{ account_id: 22, account_type: 'credit', account_subtype: 'credit card' }] },
    { rows: [] },
    { rows: [{ id: 22, provider_account_id: 'credit-1', display_name: 'Citi Card', official_name: 'Rewards', account_type: 'credit', account_subtype: 'credit card', mask: '1234', selected: true }] },
    { rows: [] },
    { rows: [] }
  ]);
  const service = createConnectionService({ pool, plaidClient: fakePlaid(), config });
  const selected = await service.selectAccount(7, 12, 22);

  assert.equal(selected.selected, true);
  assert.equal(selected.accountId, 22);
  assert.ok(pool.calls.some(call => call.sql.includes('UPDATE financial_accounts SET selected = FALSE')));
  assert.ok(pool.calls.some(call => call.sql.includes("status = 'healthy'")));
});

test('rejects a non-credit account even when it belongs to the cardholder', async () => {
  const { createConnectionService } = require('../plaid-connections');
  const pool = scriptedPool([{ rows: [] }, { rows: [] }, { rows: [{ account_id: 22, account_type: 'depository', account_subtype: 'checking' }] }, { rows: [] }]);
  const service = createConnectionService({ pool, plaidClient: fakePlaid(), config });
  await assert.rejects(service.selectAccount(7, 12, 22), /credit-card/);
});

test('rejects switching tracked accounts after a cursor has advanced', async () => {
  const { createConnectionService } = require('../plaid-connections');
  const pool = scriptedPool([
    { rows: [] },
    { rows: [] },
    { rows: [{ account_id: 23, account_type: 'credit', account_subtype: 'credit card', sync_cursor: 'cursor-1', selected_account_id: 22 }] },
    { rows: [] },
    { rows: [] }
  ]);
  const service = createConnectionService({ pool, plaidClient: fakePlaid(), config });
  await assert.rejects(service.selectAccount(7, 12, 23), /Disconnect and reconnect/);
});

test('serializes status without access-token material', async () => {
  const { createConnectionService } = require('../plaid-connections');
  const row = {
    connection_id: 12, status: 'healthy', environment: 'sandbox', last_attempt_at: null,
    last_success_at: '2029-01-01', consent_expiration_at: null, last_error_code: null,
    account_id: 22, display_name: 'Citi Card', official_name: 'Rewards', account_type: 'credit',
    account_subtype: 'credit card', mask: '1234', selected: true, review_count: '3'
  };
  const service = createConnectionService({ pool: scriptedPool([{ rows: [row] }]), plaidClient: fakePlaid(), config });
  const result = await service.getStatus(7);
  assert.equal(result[0].accounts[0].mask, '1234');
  assert.equal(result[0].reviewCount, 3);
  assert.doesNotMatch(JSON.stringify(result), /cipher|nonce|auth.?tag|access.token/i);
});

test('disconnects the provider item and makes the stored token unusable', async () => {
  const { encryptAccessToken } = require('../plaid-token-crypto');
  const { createConnectionService } = require('../plaid-connections');
  const encrypted = encryptAccessToken('access-secret', config.tokenEncryptionKey, 'sandbox');
  const pool = scriptedPool([
    { rows: [] },
    { rows: [] },
    { rows: [{ id: 12, environment: 'sandbox', access_token_ciphertext: encrypted.ciphertext, access_token_nonce: encrypted.nonce, access_token_auth_tag: encrypted.authTag, access_token_key_version: encrypted.keyVersion }] },
    { rows: [{ id: 12 }] },
    { rows: [] }
  ]);
  const plaid = fakePlaid();
  const service = createConnectionService({ pool, plaidClient: plaid, config });
  assert.deepEqual(await service.disconnect(7, 12), { id: 12, status: 'disconnected' });
  assert.deepEqual(plaid.calls, [['removeItem', 'access-secret']]);
  const update = pool.calls.find(call => call.sql.includes("status = 'disconnected'"));
  assert.deepEqual(update.params, [12, 7]);
});
