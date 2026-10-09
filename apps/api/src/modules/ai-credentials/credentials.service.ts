import { randomUUID } from 'node:crypto';
import { HttpError } from '../../shared/http/error-handler.js';
import { decryptCredential, encryptCredential } from '../../shared/security/credential-crypto.js';
import type { RuntimeEnvironment } from '../../shared/config/env.js';
import type { GeminiCredentialMetadata } from './credentials.dto.js';
import type { GeminiCredentialRepository } from './credentials.repository.js';

export interface GeminiCredentialVerifier {
  verify(key: string, model: string): Promise<Date>;
}

export class GoogleGeminiCredentialVerifier implements GeminiCredentialVerifier {
  async verify(key: string, modelName: string): Promise<Date> {
    const model = encodeURIComponent(modelName);
    try {
      // A one-token generation, not a model lookup: Google describes models to keys it will not generate for,
      // and the planner needs generation to work.
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });

      if (response.ok) return new Date();
      // Google answers 400 for a key it does not recognise, 401/403 for one without access and 404 for an unknown model.
      if ([400, 401, 403, 404].includes(response.status)) {
        throw new HttpError(400, 'INVALID_GEMINI_CREDENTIAL', 'The key cannot access the configured Gemini model.');
      }
      throw new HttpError(503, 'GEMINI_VALIDATION_UNAVAILABLE', 'Gemini credential validation is temporarily unavailable.');
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'GEMINI_VALIDATION_UNAVAILABLE', 'Gemini credential validation is temporarily unavailable.');
    }
  }
}

function toMetadata(record: Awaited<ReturnType<GeminiCredentialRepository['findByUserId']>>): GeminiCredentialMetadata {
  return {
    configured: record !== null,
    model: record?.model ?? null,
    verifiedAt: record?.verifiedAt?.toISOString() ?? null,
    credentialRevision: record?.credentialRevision ?? null,
  };
}

export class GeminiCredentialService {
  constructor(
    private readonly repository: GeminiCredentialRepository,
    private readonly environment: RuntimeEnvironment,
    private readonly verifier: GeminiCredentialVerifier,
    private readonly abortUserJobs: (userId: string) => void = () => undefined,
  ) {}

  async getMetadata(userId: string): Promise<GeminiCredentialMetadata> {
    return toMetadata(await this.repository.findByUserId(userId));
  }

  async set(userId: string, key: string, model: string): Promise<GeminiCredentialMetadata> {
    const activeVersion = this.environment.CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION;
    const encryptionKey = activeVersion ? this.environment.credentialEncryptionKeyring[activeVersion] : undefined;
    if (!activeVersion || !encryptionKey) {
      throw new HttpError(503, 'CREDENTIAL_STORAGE_UNAVAILABLE', 'Credential storage is not configured.');
    }

    const verifiedAt = await this.verifier.verify(key, model);
    const encrypted = encryptCredential({
      plaintext: key,
      userId,
      provider: 'GEMINI',
      keyVersion: activeVersion,
      key: encryptionKey,
    });
    await this.repository.upsert(userId, encrypted, model, verifiedAt);
    this.abortUserJobs(userId);
    return {
      configured: true,
      model,
      verifiedAt: verifiedAt.toISOString(),
      credentialRevision: encrypted.credentialRevision,
    };
  }

  async updateModel(userId: string, model: string): Promise<GeminiCredentialMetadata> {
    const stored = await this.repository.findByUserId(userId);
    if (!stored?.verifiedAt) {
      throw new HttpError(409, 'AI_CREDENTIAL_REQUIRED', 'Configure a Gemini API key before selecting a model.');
    }
    if (stored.model === model) return toMetadata(stored);

    const key = this.decryptStoredKey(userId, stored);
    const verifiedAt = await this.verifier.verify(key, model);
    const updated = await this.repository.updateModel(userId, stored.credentialRevision, model, randomUUID(), verifiedAt);
    if (!updated) throw new HttpError(409, 'AI_CREDENTIAL_CHANGED', 'The Gemini credential changed. Configure it again before selecting a model.');
    this.abortUserJobs(userId);
    return this.getMetadata(userId);
  }

  /** Checks that the stored key still reaches Gemini with the saved model. Nothing but the verification time changes. */
  async test(userId: string): Promise<GeminiCredentialMetadata> {
    const stored = await this.repository.findByUserId(userId);
    if (!stored?.model) {
      throw new HttpError(409, 'AI_CREDENTIAL_REQUIRED', 'Configure a Gemini API key before testing the connection.');
    }
    const verifiedAt = await this.verifier.verify(this.decryptStoredKey(userId, stored), stored.model);
    const updated = await this.repository.markVerified(userId, stored.credentialRevision, verifiedAt);
    if (!updated) throw new HttpError(409, 'AI_CREDENTIAL_CHANGED', 'The Gemini credential changed. Test the connection again.');
    return this.getMetadata(userId);
  }

  private decryptStoredKey(userId: string, stored: NonNullable<Awaited<ReturnType<GeminiCredentialRepository['findByUserId']>>>): string {
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

  async remove(userId: string): Promise<void> {
    await this.repository.delete(userId);
    this.abortUserJobs(userId);
  }
}
