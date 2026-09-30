const crypto = require('crypto');

const KEY_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';

function validateKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('Plaid token encryption key must be exactly 32 bytes.');
  }
}

function validateEnvironment(environment) {
  if (!['sandbox', 'production'].includes(environment)) {
    throw new Error('Plaid token environment must be sandbox or production.');
  }
}

function encryptAccessToken(token, key, environment) {
  validateKey(key);
  validateEnvironment(environment);
  if (typeof token !== 'string' || !token) throw new Error('A Plaid access token is required.');

  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(Buffer.from(`plaid:${environment}:v${KEY_VERSION}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: KEY_VERSION,
    environment
  };
}

function decryptAccessToken(record, key, environment) {
  validateKey(key);
  validateEnvironment(environment);
  if (!record || record.keyVersion !== KEY_VERSION) throw new Error('Unsupported Plaid token encryption version.');
  if (record.environment !== environment) throw new Error('Plaid token environment does not match the configured environment.');

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(record.nonce, 'base64'));
    decipher.setAAD(Buffer.from(`plaid:${environment}:v${KEY_VERSION}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch (_error) {
    throw new Error('Unable to decrypt Plaid access token.');
  }
}

module.exports = { encryptAccessToken, decryptAccessToken };
