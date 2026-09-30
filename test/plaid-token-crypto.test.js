const test = require('node:test');
const assert = require('node:assert/strict');

const KEY = Buffer.alloc(32, 3);
const OTHER_KEY = Buffer.alloc(32, 4);

test('encrypts and decrypts an access token without retaining plaintext', () => {
  const { encryptAccessToken, decryptAccessToken } = require('../plaid-token-crypto');
  const encrypted = encryptAccessToken('access-sandbox-123', KEY, 'sandbox');

  assert.equal(decryptAccessToken(encrypted, KEY, 'sandbox'), 'access-sandbox-123');
  assert.equal(JSON.stringify(encrypted).includes('access-sandbox-123'), false);
  assert.equal(encrypted.keyVersion, 1);
});

test('uses a fresh nonce for every encryption', () => {
  const { encryptAccessToken } = require('../plaid-token-crypto');
  const first = encryptAccessToken('same-token', KEY, 'sandbox');
  const second = encryptAccessToken('same-token', KEY, 'sandbox');
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test('rejects tampering, a wrong key, and an environment mismatch', () => {
  const { encryptAccessToken, decryptAccessToken } = require('../plaid-token-crypto');
  const encrypted = encryptAccessToken('access-production-123', KEY, 'production');
  const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` };

  assert.throws(() => decryptAccessToken(tampered, KEY, 'production'), /Unable to decrypt Plaid access token/);
  assert.throws(() => decryptAccessToken(encrypted, OTHER_KEY, 'production'), /Unable to decrypt Plaid access token/);
  assert.throws(() => decryptAccessToken(encrypted, KEY, 'sandbox'), /environment/);
});

test('rejects invalid inputs without echoing token or key material', () => {
  const { encryptAccessToken, decryptAccessToken } = require('../plaid-token-crypto');
  assert.throws(() => encryptAccessToken('sensitive-token', Buffer.alloc(12), 'sandbox'), error => {
    assert.equal(error.message.includes('sensitive-token'), false);
    return /32 bytes/.test(error.message);
  });
  assert.throws(() => decryptAccessToken({ keyVersion: 2 }, KEY, 'sandbox'), /version/);
});
