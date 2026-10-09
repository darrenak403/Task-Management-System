import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { HttpError } from '../../src/shared/http/error-handler.js';
import { AuthRepository } from '../../src/modules/auth/auth.repository.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { GeminiCredentialRepository } from '../../src/modules/ai-credentials/credentials.repository.js';
import {
  GeminiCredentialService,
  type GeminiCredentialVerifier,
} from '../../src/modules/ai-credentials/credentials.service.js';
import { decryptCredential } from '../../src/shared/security/credential-crypto.js';
import { parseEnvironment } from '../../src/shared/config/env.js';
import { createTestDatabase, resetTestDatabase } from '../helpers/db.js';

const prisma = createTestDatabase();
const logger = pino({ level: 'silent' });
const key = Buffer.alloc(32, 43).toString('base64');
const environment = parseEnvironment({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: 'test-v1',
  CREDENTIAL_ENCRYPTION_KEYRING: JSON.stringify({ 'test-v1': key }),
});
const verifiedKeys: string[] = [];
const verifiedModels: string[] = [];
const abortedUserIds: string[] = [];
const verifier: GeminiCredentialVerifier = {
  async verify(candidate, model) {
    if (candidate === 'invalid-provider-key-material-123') {
      throw new HttpError(400, 'INVALID_GEMINI_CREDENTIAL', 'The key is not valid for the configured model.');
    }
    if (model === 'invalid-gemini-model') {
      throw new HttpError(400, 'INVALID_GEMINI_CREDENTIAL', 'The key cannot access the configured Gemini model.');
    }
    if (candidate === 'temporary-provider-unavailable-key-123') {
      throw new HttpError(503, 'GEMINI_VALIDATION_UNAVAILABLE', 'Gemini credential validation is unavailable.');
    }
    if (model === 'temporary-gemini-model') {
      throw new HttpError(503, 'GEMINI_VALIDATION_UNAVAILABLE', 'Gemini credential validation is unavailable.');
    }
    verifiedKeys.push(candidate);
    verifiedModels.push(model);
    return new Date('2026-10-09T00:00:00.000Z');
  },
};
const authService = new AuthService(new AuthRepository(prisma));
const credentialService = new GeminiCredentialService(
  new GeminiCredentialRepository(prisma),
  environment,
  verifier,
  (userId) => abortedUserIds.push(userId),
);
const trustedOrigin = environment.APP_ORIGIN;
const password = 'valid-passphrase-123';
let app = createCredentialsApp();

function createCredentialsApp() {
  return createApp({
    logger,
    appOrigin: environment.APP_ORIGIN,
    authService,
    credentialService,
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  verifiedKeys.length = 0;
  verifiedModels.length = 0;
  abortedUserIds.length = 0;
  await resetTestDatabase(prisma);
  app = createCredentialsApp();
});

afterAll(async () => {
  await prisma.$disconnect();
  await logger.flush();
});

async function register(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/register')
    .set('Origin', trustedOrigin)
    .send({ email, password });
  expect(response.status).toBe(201);
  return response.headers['set-cookie'][0].split(';', 1)[0];
}

const credentialPath = '/api/me/ai-provider-credentials/gemini';

describe('account-scoped Gemini BYOK vault', () => {
  it('returns metadata only and stores an authenticated ciphertext', async () => {
    const cookie = await register('owner@example.com');
    const originalKey = 'AIzaSyDUMMYcredentialKeyForTest-0123456789';
    const before = await request(app).get(credentialPath).set('Cookie', cookie);
    const response = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: originalKey });
    const row = await prisma.userGeminiCredential.findFirst();
    const readback = row
      ? decryptCredential({
          encrypted: {
            ciphertext: Buffer.from(row.ciphertext),
            nonce: Buffer.from(row.nonce),
            authenticationTag: Buffer.from(row.authenticationTag),
            encryptionKeyVersion: row.encryptionKeyVersion,
            credentialRevision: row.credentialRevision,
          },
          userId: row.userId,
          provider: row.provider,
          keyring: environment.credentialEncryptionKeyring,
        })
      : null;

    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.data).toEqual({ configured: false, model: null, verifiedAt: null, credentialRevision: null });
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(originalKey);
    expect(JSON.stringify(response.body)).not.toContain('ciphertext');
    expect(row).not.toBeNull();
    expect(row?.ciphertext).not.toEqual(Buffer.from(originalKey));
    expect(readback).toBe(originalKey);
    expect(row?.model).toBe('gemini-test-model');
    expect(verifiedKeys).toEqual([originalKey]);
    expect(verifiedModels).toEqual(['gemini-test-model']);
  });

  it('changes the account model without replacing or exposing its Gemini key', async () => {
    const cookie = await register('model-owner@example.com');
    const secretKey = 'AIzaSyAccountModelChangeCredential-1234567890';
    const configured = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: secretKey });
    const before = await prisma.userGeminiCredential.findFirst();

    const response = await request(app)
      .patch(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-next-model' });
    const after = await prisma.userGeminiCredential.findFirst();

    expect(configured.status).toBe(200);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ configured: true, model: 'gemini-next-model' });
    expect(response.body.data.credentialRevision).not.toBe(before?.credentialRevision);
    expect(JSON.stringify(response.body)).not.toContain(secretKey);
    expect(JSON.stringify(response.body)).not.toContain('ciphertext');
    expect(await prisma.userGeminiCredential.count()).toBe(1);
    expect(after?.model).toBe('gemini-next-model');
    expect(after?.ciphertext).toEqual(before?.ciphertext);
    expect(after?.nonce).toEqual(before?.nonce);
    expect(after?.authenticationTag).toEqual(before?.authenticationTag);
    expect(after?.credentialRevision).not.toBe(before?.credentialRevision);
    expect(verifiedKeys).toEqual([secretKey, secretKey]);
    expect(verifiedModels).toEqual(['gemini-test-model', 'gemini-next-model']);
  });

  it('treats selecting the current model as a no-op', async () => {
    const cookie = await register('same-model-owner@example.com');
    const secretKey = 'AIzaSySameModelCredential-1234567890';
    await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: secretKey });
    const before = await prisma.userGeminiCredential.findFirst();

    const response = await request(app)
      .patch(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model' });
    const after = await prisma.userGeminiCredential.findFirst();

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ configured: true, model: 'gemini-test-model' });
    expect(after?.credentialRevision).toBe(before?.credentialRevision);
    expect(after?.verifiedAt).toEqual(before?.verifiedAt);
    expect(verifiedKeys).toEqual([secretKey]);
    expect(verifiedModels).toEqual(['gemini-test-model']);
    expect(abortedUserIds).toHaveLength(1);
  });

  it('leaves the current key and model untouched when model verification fails', async () => {
    const cookie = await register('model-validation@example.com');
    const secretKey = 'AIzaSyModelValidationCredential-1234567890';
    await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: secretKey });
    const before = await prisma.userGeminiCredential.findFirst();

    const invalidModel = await request(app)
      .patch(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'invalid-gemini-model' });
    const unavailableModel = await request(app)
      .patch(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'temporary-gemini-model' });
    const after = await prisma.userGeminiCredential.findFirst();

    expect(invalidModel.status).toBe(400);
    expect(unavailableModel.status).toBe(503);
    expect(after?.model).toBe(before?.model);
    expect(after?.credentialRevision).toBe(before?.credentialRevision);
    expect(after?.ciphertext).toEqual(before?.ciphertext);
    expect(after?.nonce).toEqual(before?.nonce);
    expect(after?.authenticationTag).toEqual(before?.authenticationTag);
    expect(JSON.stringify(invalidModel.body)).not.toContain(secretKey);
    expect(JSON.stringify(unavailableModel.body)).not.toContain(secretKey);
  });

  it('does not allow one account to read, change, or replace another account credential', async () => {
    const ownerCookie = await register('owner@example.com');
    const otherCookie = await register('other@example.com');
    const secretKey = 'AIzaSyFirstAccountCredential-0123456789';
    const otherSecretKey = 'AIzaSyOtherAccountCredential-9876543210';
    await request(app).put(credentialPath).set('Origin', trustedOrigin).set('Cookie', ownerCookie).send({ model: 'gemini-test-model', key: secretKey });
    const ownerBefore = await prisma.userGeminiCredential.findFirst({
      where: { user: { email: 'owner@example.com' } },
    });

    const otherRead = await request(app).get(credentialPath).set('Cookie', otherCookie);
    const otherModelChange = await request(app)
      .patch(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', otherCookie)
      .send({ model: 'gemini-next-model' });
    const otherReplace = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', otherCookie)
      .send({ model: 'gemini-test-model', key: otherSecretKey });
    const otherModelUpdate = await request(app)
      .patch(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', otherCookie)
      .send({ model: 'gemini-next-model' });
    const ownerRow = await prisma.userGeminiCredential.findFirst({
      where: { user: { email: 'owner@example.com' } },
    });
    const otherRow = await prisma.userGeminiCredential.findFirst({
      where: { user: { email: 'other@example.com' } },
    });

    expect(otherRead.body.data.configured).toBe(false);
    expect(otherModelChange.status).toBe(409);
    expect(otherModelChange.body.error.code).toBe('AI_CREDENTIAL_REQUIRED');
    expect(otherReplace.status).toBe(200);
    expect(otherModelUpdate.status).toBe(200);
    expect(otherModelUpdate.body.data).toMatchObject({ configured: true, model: 'gemini-next-model' });
    expect(ownerRow?.credentialRevision).toBe(ownerBefore?.credentialRevision);
    expect(ownerRow?.model).toBe('gemini-test-model');
    expect(ownerRow?.credentialRevision).not.toBe(otherReplace.body.data.credentialRevision);
    expect(otherRow?.model).toBe('gemini-next-model');
    expect(otherRow?.credentialRevision).not.toBe(ownerRow?.credentialRevision);
    expect(verifiedKeys).toEqual([secretKey, otherSecretKey, otherSecretKey]);
    expect(verifiedModels).toEqual(['gemini-test-model', 'gemini-test-model', 'gemini-next-model']);
  });

  it('does not allow another account to delete the owner credential', async () => {
    const ownerCookie = await register('owner@example.com');
    const otherCookie = await register('other@example.com');
    const secretKey = 'AIzaSyOwnerCredentialForDelete-0123456789';
    await request(app).put(credentialPath).set('Origin', trustedOrigin).set('Cookie', ownerCookie).send({ model: 'gemini-test-model', key: secretKey });

    const otherDelete = await request(app)
      .delete(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', otherCookie)
      .set('Content-Type', 'application/json')
      .send({});
    const ownerRead = await request(app).get(credentialPath).set('Cookie', ownerCookie);
    const ownerRow = await prisma.userGeminiCredential.findFirst({
      where: { user: { email: 'owner@example.com' } },
    });

    expect(otherDelete.status).toBe(204);
    expect(ownerRead.body.data.configured).toBe(true);
    expect(ownerRow).not.toBeNull();
    expect(verifiedKeys).toEqual([secretKey]);
  });

  it('requires a session for every credential operation', async () => {
    const read = await request(app).get(credentialPath);
    const write = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .send({ model: 'gemini-test-model', key: 'AIzaSyUnauthenticatedCredential-0123456789' });
    const modelUpdate = await request(app)
      .patch(credentialPath)
      .set('Origin', trustedOrigin)
      .send({ model: 'gemini-test-model' });
    const remove = await request(app)
      .delete(credentialPath)
      .set('Origin', trustedOrigin)
      .send({});

    expect(read.status).toBe(401);
    expect(write.status).toBe(401);
    expect(modelUpdate.status).toBe(401);
    expect(remove.status).toBe(401);
    expect(await prisma.userGeminiCredential.count()).toBe(0);
  });

  it('requires an existing account credential before changing its model', async () => {
    const cookie = await register('missing-model-credential@example.com');
    const response = await request(app)
      .patch(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('AI_CREDENTIAL_REQUIRED');
    expect(await prisma.userGeminiCredential.count()).toBe(0);
    expect(verifiedKeys).toEqual([]);
  });

  it('rejects malformed account model updates', async () => {
    const cookie = await register('malformed-model@example.com');
    const responses = await Promise.all([
      request(app).patch(credentialPath).set('Origin', trustedOrigin).set('Cookie', cookie).send({}),
      request(app).patch(credentialPath).set('Origin', trustedOrigin).set('Cookie', cookie).send({ model: '' }),
      request(app).patch(credentialPath).set('Origin', trustedOrigin).set('Cookie', cookie).send({ model: 'x'.repeat(129) }),
      request(app).patch(credentialPath).set('Origin', trustedOrigin).set('Cookie', cookie).send({ model: 'gemini-test-model', key: 'not-accepted-here' }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    expect(responses.every((response) => response.body.error.code === 'VALIDATION_ERROR')).toBe(true);
    expect(await prisma.userGeminiCredential.count()).toBe(0);
    expect(verifiedKeys).toEqual([]);
  });

  it('rejects malformed keys and accepts the documented minimum length', async () => {
    const cookie = await register('owner@example.com');
    const tooShort = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: 'x'.repeat(19) });
    const padded = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: ` ${'x'.repeat(20)}` });
    const tooLong = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: 'x'.repeat(513) });
    const extraField = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: 'x'.repeat(20), reveal: true });
    const minimumLength = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: 'x'.repeat(20) });

    expect(tooShort.status).toBe(400);
    expect(padded.status).toBe(400);
    expect(tooLong.status).toBe(400);
    expect(extraField.status).toBe(400);
    expect(minimumLength.status).toBe(200);
  });

  it('rate-limits credential writes per account and sets Retry-After', async () => {
    const cookie = await register('owner@example.com');
    const writes = await Promise.all(
      Array.from({ length: 5 }, (_, index) => request(app)
        .put(credentialPath)
        .set('Origin', trustedOrigin)
        .set('Cookie', cookie)
        .send({ model: 'gemini-test-model', key: `AIzaSyCredentialRateLimit-${String(index).padStart(2, '0')}-0123456789` })),
    );
    const limited = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: 'AIzaSyCredentialRateLimit-LIMIT-0123456789' });

    expect(writes.every((response) => response.status === 200)).toBe(true);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(verifiedKeys).toHaveLength(5);
  });

  it('applies the account write rate limit to model PATCH requests', async () => {
    const cookie = await register('model-patch-rate-limit@example.com');
    const updates = await Promise.all(
      Array.from({ length: 5 }, () => request(app)
        .patch(credentialPath)
        .set('Origin', trustedOrigin)
        .set('Cookie', cookie)
        .send({ model: 'gemini-test-model' })),
    );
    const limited = await request(app)
      .patch(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model' });

    expect(updates.every((response) => response.status === 409)).toBe(true);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(verifiedKeys).toEqual([]);
  });

  it('rejects missing, mismatched, or non-JSON origins on DELETE without removing the key', async () => {
    const cookie = await register('owner@example.com');
    await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: 'AIzaSyCsrfDeleteCredential-0123456789' });

    const missingOrigin = await request(app).delete(credentialPath).set('Cookie', cookie).send({});
    const mismatchedOrigin = await request(app)
      .delete(credentialPath)
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookie)
      .send({});
    const nonJson = await request(app)
      .delete(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .set('Content-Type', 'text/plain')
      .send('delete');
    const readback = await request(app).get(credentialPath).set('Cookie', cookie);

    expect(missingOrigin.status).toBe(403);
    expect(mismatchedOrigin.status).toBe(403);
    expect(nonJson.status).toBe(415);
    expect(readback.body.data.configured).toBe(true);
  });

  it('keeps invalid provider credentials out of the database and responses', async () => {
    const cookie = await register('owner@example.com');
    const invalidKey = 'invalid-provider-key-material-123';
    const response = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: invalidKey });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain(invalidKey);
    expect(await prisma.userGeminiCredential.count()).toBe(0);
  });

  it('rotates the credential revision and delete removes only the app copy', async () => {
    const cookie = await register('owner@example.com');
    const first = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: 'AIzaSyFirstCredentialRevision-1234567890' });
    const second = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: 'AIzaSySecondCredentialRevision-0987654321' });
    const deleted = await request(app)
      .delete(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send({});
    const after = await request(app).get(credentialPath).set('Cookie', cookie);

    expect(first.body.data.credentialRevision).not.toBe(second.body.data.credentialRevision);
    expect(deleted.status).toBe(204);
    expect(await prisma.userGeminiCredential.count()).toBe(0);
    expect(after.body.data.configured).toBe(false);
  });

  it('keeps the credential unchanged when validation is temporarily unavailable', async () => {
    const cookie = await register('owner@example.com');
    const initial = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: 'AIzaSyExistingCredentialRevision-0123456789' });
    const before = await prisma.userGeminiCredential.findFirst();
    const response = await request(app)
      .put(credentialPath)
      .set('Origin', trustedOrigin)
      .set('Cookie', cookie)
      .send({ model: 'gemini-test-model', key: 'temporary-provider-unavailable-key-123' });
    const after = await prisma.userGeminiCredential.findFirst();

    expect(initial.status).toBe(200);
    expect(response.status).toBe(503);
    expect(after?.credentialRevision).toBe(before?.credentialRevision);
    expect(after?.ciphertext).toEqual(before?.ciphertext);
  });
});
