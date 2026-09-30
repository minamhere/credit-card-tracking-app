const DEFAULT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const MAX_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function parseBoolean(value, name, defaultValue) {
  if (value == null || value === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false.`);
}

function parseEncryptionKey(value) {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('PLAID_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 value.');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error('PLAID_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 value.');
  }
  return key;
}

function loadPlaidConfig(env = process.env) {
  const clientId = String(env.PLAID_CLIENT_ID || '').trim();
  const secret = String(env.PLAID_SECRET || '').trim();
  const environment = String(env.PLAID_ENV || 'sandbox').trim().toLowerCase();
  const encryptionValue = String(env.PLAID_TOKEN_ENCRYPTION_KEY || '').trim();
  const hasAnyCredential = Boolean(clientId || secret || encryptionValue);

  if (!['sandbox', 'production'].includes(environment)) {
    throw new Error('PLAID_ENV must be either sandbox or production.');
  }
  if (hasAnyCredential && (!clientId || !secret || !encryptionValue)) {
    throw new Error('Plaid configuration is incomplete.');
  }

  const intervalRaw = env.PLAID_SYNC_INTERVAL_MS == null || env.PLAID_SYNC_INTERVAL_MS === ''
    ? DEFAULT_SYNC_INTERVAL_MS
    : Number(env.PLAID_SYNC_INTERVAL_MS);
  if (!Number.isInteger(intervalRaw) || intervalRaw < MIN_SYNC_INTERVAL_MS || intervalRaw > MAX_SYNC_INTERVAL_MS) {
    throw new Error(`PLAID_SYNC_INTERVAL_MS must be an integer from ${MIN_SYNC_INTERVAL_MS} to ${MAX_SYNC_INTERVAL_MS}.`);
  }

  return {
    clientId,
    secret,
    environment,
    tokenEncryptionKey: hasAnyCredential ? parseEncryptionKey(encryptionValue) : null,
    syncIntervalMs: intervalRaw,
    autoSync: parseBoolean(env.PLAID_AUTO_SYNC, 'PLAID_AUTO_SYNC', false)
  };
}

module.exports = {
  loadPlaidConfig,
  DEFAULT_SYNC_INTERVAL_MS,
  MIN_SYNC_INTERVAL_MS,
  MAX_SYNC_INTERVAL_MS
};
