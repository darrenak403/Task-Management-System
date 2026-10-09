import type { PrismaClient } from '../../generated/prisma/client.js';
import type { EncryptedCredential } from '../../shared/security/credential-crypto.js';

export class GeminiCredentialRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByUserId(userId: string) {
    return this.prisma.userGeminiCredential.findUnique({ where: { userId } });
  }

  upsert(userId: string, encrypted: EncryptedCredential, model: string, verifiedAt: Date): Promise<void> {
    const ciphertext = toPrismaBytes(encrypted.ciphertext);
    const nonce = toPrismaBytes(encrypted.nonce);
    const authenticationTag = toPrismaBytes(encrypted.authenticationTag);
    return this.prisma.userGeminiCredential.upsert({
      where: { userId },
      create: {
        userId,
        provider: 'GEMINI',
        ciphertext,
        nonce,
        authenticationTag,
        encryptionKeyVersion: encrypted.encryptionKeyVersion,
        credentialRevision: encrypted.credentialRevision,
        model,
        verifiedAt,
      },
      update: {
        provider: 'GEMINI',
        ciphertext,
        nonce,
        authenticationTag,
        encryptionKeyVersion: encrypted.encryptionKeyVersion,
        credentialRevision: encrypted.credentialRevision,
        model,
        verifiedAt,
      },
    }).then(() => undefined);
  }

  async updateModel(
    userId: string,
    expectedRevision: string,
    model: string,
    credentialRevision: string,
    verifiedAt: Date,
  ): Promise<boolean> {
    const updated = await this.prisma.userGeminiCredential.updateMany({
      where: { userId, credentialRevision: expectedRevision, verifiedAt: { not: null } },
      data: { model, credentialRevision, verifiedAt },
    });
    return updated.count === 1;
  }

  /** Records a successful connection test without changing the credential itself. */
  async markVerified(userId: string, expectedRevision: string, verifiedAt: Date): Promise<boolean> {
    const updated = await this.prisma.userGeminiCredential.updateMany({
      where: { userId, credentialRevision: expectedRevision },
      data: { verifiedAt },
    });
    return updated.count === 1;
  }

  async delete(userId: string): Promise<void> {
    await this.prisma.userGeminiCredential.deleteMany({ where: { userId } });
  }
}

function toPrismaBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length);
  bytes.set(value);
  return bytes;
}
