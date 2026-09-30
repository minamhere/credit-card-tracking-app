const test = require('node:test');
const assert = require('node:assert/strict');

const KEY = Buffer.alloc(32, 7).toString('base64');

test('loads a complete sandbox configuration with explicit scheduler settings', () => {
  const { loadPlaidConfig } = require('../plaid-config');
  const result = loadPlaidConfig({
    PLAID_CLIENT_ID: 'client-id',
    PLAID_SECRET: 'sandbox-secret',
    PLAID_ENV: 'sandbox',
    PLAID_TOKEN_ENCRYPTION_KEY: KEY,
    PLAID_AUTO_SYNC: 'true',
    PLAID_SYNC_INTERVAL_MS: '3600000'
  });

  assert.deepEqual(result, {
    clientId: 'client-id',
    secret: 'sandbox-secret',
    environment: 'sandbox',
    tokenEncryptionKey: Buffer.alloc(32, 7),
    syncIntervalMs: 3600000,
    autoSync: true
  });
});

test('allows Plaid to be entirely unconfigured', () => {
  const { loadPlaidConfig } = require('../plaid-config');
  assert.deepEqual(loadPlaidConfig({}), {
    clientId: '',
    secret: '',
    environment: 'sandbox',
    tokenEncryptionKey: null,
    syncIntervalMs: 21600000,
    autoSync: false
  });
});

test('rejects unsupported environments and incomplete credentials without exposing secrets', () => {
  const { loadPlaidConfig } = require('../plaid-config');
  const secret = 'do-not-leak-this-secret';
  assert.throws(
    () => loadPlaidConfig({ PLAID_CLIENT_ID: 'id', PLAID_SECRET: secret, PLAID_ENV: 'development', PLAID_TOKEN_ENCRYPTION_KEY: KEY }),
    error => error.message.includes('PLAID_ENV') && !error.message.includes(secret)
  );
  assert.throws(
    () => loadPlaidConfig({ PLAID_CLIENT_ID: 'id', PLAID_SECRET: secret, PLAID_ENV: 'sandbox' }),
    error => error.message.includes('incomplete') && !error.message.includes(secret)
  );
});

test('requires an exact 32-byte base64 encryption key', () => {
  const { loadPlaidConfig } = require('../plaid-config');
  const base = { PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret', PLAID_ENV: 'production' };
  assert.throws(() => loadPlaidConfig({ ...base, PLAID_TOKEN_ENCRYPTION_KEY: 'not-base64!' }), /32-byte base64/);
  assert.throws(() => loadPlaidConfig({ ...base, PLAID_TOKEN_ENCRYPTION_KEY: Buffer.alloc(31).toString('base64') }), /32-byte base64/);
});

test('parses booleans strictly and bounds the sync interval', () => {
  const { loadPlaidConfig } = require('../plaid-config');
  const base = { PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret', PLAID_ENV: 'sandbox', PLAID_TOKEN_ENCRYPTION_KEY: KEY };
  assert.throws(() => loadPlaidConfig({ ...base, PLAID_AUTO_SYNC: 'yes' }), /PLAID_AUTO_SYNC/);
  assert.throws(() => loadPlaidConfig({ ...base, PLAID_SYNC_INTERVAL_MS: '899999' }), /PLAID_SYNC_INTERVAL_MS/);
  assert.throws(() => loadPlaidConfig({ ...base, PLAID_SYNC_INTERVAL_MS: '604800001' }), /PLAID_SYNC_INTERVAL_MS/);
});
