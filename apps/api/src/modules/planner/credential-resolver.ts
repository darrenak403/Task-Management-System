import type { RuntimeEnvironment } from '../../shared/config/env.js';
import { decryptCredential } from '../../shared/security/credential-crypto.js';
import { HttpError } from '../../shared/http/error-handler.js';
import type { GeminiCredentialRepository } from '../ai-credentials/credentials.repository.js';

export class PlannerCredentialResolver {
  constructor(
    private readonly repository: GeminiCredentialRepository,
    private readonly environment: RuntimeEnvironment,
  ) {}

  async resolve(userId: string, expectedRevision: string): Promise<string> {
    const stored = await this.repository.findByUserId(userId);
    if (!stored || stored.credentialRevision !== expectedRevision || !stored.verifiedAt) {
      throw new HttpError(409, 'AI_CREDENTIAL_CHANGED', 'The Gemini credential changed. Configure it again before starting a new plan.');
    }
    try {
      return decryptCredential({
        encrypted: {
          ciphertext: Buffer.from(stored.ciphertext),
          nonce: Buffer.from(stored.nonce),
          authenticationTag: Buffer.from(stored.authenticationTag),
          encryptionKeyVersion: stored.encryptionKeyVersion,
        },
        userId,
        provider: 'GEMINI',
        keyring: this.environment.credentialEncryptionKeyring,
      });
    } catch {
      throw new HttpError(503, 'AI_CREDENTIAL_UNAVAILABLE', 'The stored Gemini credential cannot be used. Reconfigure the credential.');
    }
  }

  async matchesCurrent(userId: string, expectedRevision: string): Promise<boolean> {
    const stored = await this.repository.findByUserId(userId);
    return Boolean(stored && stored.credentialRevision === expectedRevision && stored.verifiedAt);
  }
}
