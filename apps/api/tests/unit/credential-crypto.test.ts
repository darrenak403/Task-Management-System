import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptCredential, encryptCredential } from '../../src/shared/security/credential-crypto.js';

const key = randomBytes(32);
const keyring = { 'key-v1': key };
const plaintext = 'AIzaSyCredentialMaterialForCryptoTest-1234567890';

function encrypt() {
  return encryptCredential({
    plaintext,
    userId: '8c6da20d-8588-44d4-8e11-dc8dfc400000',
    provider: 'GEMINI',
    keyVersion: 'key-v1',
    key,
  });
}

describe('BYOK encryption', () => {
  it('uses AES-GCM and binds ciphertext to the account/provider', () => {
    const encrypted = encrypt();
    const recovered = decryptCredential({
      encrypted,
      userId: '8c6da20d-8588-44d4-8e11-dc8dfc400000',
      provider: 'GEMINI',
      keyring,
    });

    expect(encrypted.nonce).toHaveLength(12);
    expect(encrypted.authenticationTag).toHaveLength(16);
    expect(encrypted.ciphertext.toString('utf8')).not.toBe(plaintext);
    expect(recovered).toBe(plaintext);
  });

  it('fails closed for wrong account, provider, missing key version, and modified bytes', () => {
    const encrypted = encrypt();

    expect(() => decryptCredential({ encrypted, userId: 'different-user', provider: 'GEMINI', keyring })).toThrow();
    expect(() => decryptCredential({ encrypted, userId: '8c6da20d-8588-44d4-8e11-dc8dfc400000', provider: 'OTHER', keyring })).toThrow();
    expect(() => decryptCredential({ encrypted, userId: '8c6da20d-8588-44d4-8e11-dc8dfc400000', provider: 'GEMINI', keyring: {} })).toThrow();

    const tampered = { ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext) };
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 0xff;
    expect(() => decryptCredential({ encrypted: tampered, userId: '8c6da20d-8588-44d4-8e11-dc8dfc400000', provider: 'GEMINI', keyring })).toThrow();
  });

  it('generates a fresh nonce and revision for each write', () => {
    const first = encrypt();
    const second = encrypt();
    expect(first.nonce).not.toEqual(second.nonce);
    expect(first.credentialRevision).not.toBe(second.credentialRevision);
  });

  it('keeps old credentials decryptable during key rotation only while the old version is configured', () => {
    const encryptedWithOldKey = encryptCredential({
      plaintext,
      userId: '8c6da20d-8588-44d4-8e11-dc8dfc400000',
      provider: 'GEMINI',
      keyVersion: 'key-v1',
      key,
    });
    const rotatedKeyring = {
      'key-v1': key,
      'key-v2': randomBytes(32),
    };
    const recoveredDuringRotation = decryptCredential({
      encrypted: encryptedWithOldKey,
      userId: '8c6da20d-8588-44d4-8e11-dc8dfc400000',
      provider: 'GEMINI',
      keyring: rotatedKeyring,
    });

    expect(recoveredDuringRotation).toBe(plaintext);
    expect(() => decryptCredential({
      encrypted: encryptedWithOldKey,
      userId: '8c6da20d-8588-44d4-8e11-dc8dfc400000',
      provider: 'GEMINI',
      keyring: { 'key-v2': rotatedKeyring['key-v2'] },
    })).toThrow();
  });
});
