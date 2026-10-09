import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

export type EncryptedCredential = {
  ciphertext: Buffer;
  nonce: Buffer;
  authenticationTag: Buffer;
  encryptionKeyVersion: string;
  credentialRevision: string;
};

export class CredentialCryptoError extends Error {
  constructor() {
    super('The stored credential cannot be decrypted with the configured keyring.');
    this.name = 'CredentialCryptoError';
  }
}

function aad(userId: string, provider: string): Buffer {
  return Buffer.from(`${userId}:${provider}`, 'utf8');
}

export function encryptCredential(input: {
  plaintext: string;
  userId: string;
  provider: string;
  keyVersion: string;
  key: Buffer;
}): EncryptedCredential {
  if (input.key.length !== 32) throw new CredentialCryptoError();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', input.key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad(input.userId, input.provider));
  const ciphertext = Buffer.concat([cipher.update(input.plaintext, 'utf8'), cipher.final()]);

  return {
    ciphertext,
    nonce,
    authenticationTag: cipher.getAuthTag(),
    encryptionKeyVersion: input.keyVersion,
    credentialRevision: randomUUID(),
  };
}

export function decryptCredential(input: {
  encrypted: Omit<EncryptedCredential, 'credentialRevision'>;
  userId: string;
  provider: string;
  keyring: Readonly<Record<string, Buffer>>;
}): string {
  const key = input.keyring[input.encrypted.encryptionKeyVersion];
  if (!key || key.length !== 32) throw new CredentialCryptoError();

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, input.encrypted.nonce, { authTagLength: 16 });
    decipher.setAAD(aad(input.userId, input.provider));
    decipher.setAuthTag(input.encrypted.authenticationTag);
    return Buffer.concat([decipher.update(input.encrypted.ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new CredentialCryptoError();
  }
}
