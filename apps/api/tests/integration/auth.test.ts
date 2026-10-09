import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { AuthRepository } from '../../src/modules/auth/auth.repository.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { createSessionToken, hashSessionToken } from '../../src/shared/security/session-token.js';
import { createTestDatabase, resetTestDatabase } from '../helpers/db.js';

const prisma = createTestDatabase();
const logger = pino({ level: 'silent' });
const authService = new AuthService(new AuthRepository(prisma));
const trustedOrigin = 'http://localhost:3000';
const goodPassword = 'valid-passphrase-123';
let app = createAuthApp();

function createAuthApp() {
  return createApp({
    logger,
    appOrigin: trustedOrigin,
    authService,
    secureCookie: false,
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetTestDatabase(prisma);
  app = createAuthApp();
});

afterAll(async () => {
  await prisma.$disconnect();
  await logger.flush();
});

function register(email = 'member@example.com') {
  return request(app)
    .post('/api/auth/register')
    .set('Origin', trustedOrigin)
    .send({ email, password: goodPassword, displayName: ' Member ' });
}

describe('session authentication', () => {
  it('normalizes email and stores only a password hash and a session-token hash', async () => {
    const response = await register('  Member@Example.com  ');
    const user = await prisma.user.findUnique({ where: { email: 'member@example.com' } });
    const sessions = await prisma.session.findMany({ where: { userId: response.body.data.id } });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({
      id: expect.any(String),
      email: 'member@example.com',
      displayName: 'Member',
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(user?.passwordHash).not.toBe(goodPassword);
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(response.headers['set-cookie'][0]).toMatch(/SameSite=Lax/i);
    expect(response.headers['set-cookie'][0]).toMatch(/Path=\//);
    expect(response.headers['set-cookie'][0]).not.toMatch(/Domain=/i);
  });

  it('marks production session cookies Secure and keeps them host-only', async () => {
    const secureApp = createApp({
      logger,
      appOrigin: trustedOrigin,
      authService,
      secureCookie: true,
    });
    const response = await request(secureApp)
      .post('/api/auth/register')
      .set('Origin', trustedOrigin)
      .send({ email: 'secure@example.com', password: goodPassword });
    const cookie = response.headers['set-cookie'][0];

    expect(response.status).toBe(201);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('does not write account secrets or session tokens to application logs', async () => {
    const logLines: string[] = [];
    const auditLogger = pino({ level: 'info' }, { write: (line: string) => logLines.push(line) });
    const auditApp = createApp({
      logger: auditLogger,
      appOrigin: trustedOrigin,
      authService,
      secureCookie: false,
    });
    const response = await request(auditApp)
      .post('/api/auth/register')
      .set('Origin', trustedOrigin)
      .send({ email: 'private@example.com', password: goodPassword });
    const sessionToken = response.headers['set-cookie'][0].split(';', 1)[0].split('=', 2)[1];
    await auditLogger.flush();
    const logs = logLines.join('');

    expect(response.status).toBe(201);
    expect(sessionToken).toBeTruthy();
    expect(logs).not.toContain('private@example.com');
    expect(logs).not.toContain(goodPassword);
    expect(logs).not.toContain(sessionToken);
    expect(logs).not.toContain('passwordHash');
    expect(logs).not.toContain('tokenHash');
  });

  it('prevents duplicate normalized emails under concurrent registration', async () => {
    const responses = await Promise.all([
      register('member@example.com'),
      register(' MEMBER@example.com '),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.user.count()).toBe(1);
  });

  it('uses the same public error for unknown email and wrong password', async () => {
    await register();
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .set('Origin', trustedOrigin)
      .send({ email: 'member@example.com', password: 'incorrect-passphrase' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .set('Origin', trustedOrigin)
      .send({ email: 'missing@example.com', password: 'incorrect-passphrase' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('rotates the browser session on login and revokes the current session on logout', async () => {
    const registered = await register();
    const oldCookie = registered.headers['set-cookie'][0].split(';', 1)[0];
    const me = await request(app).get('/api/auth/me').set('Cookie', oldCookie);
    const login = await request(app)
      .post('/api/auth/login')
      .set('Origin', trustedOrigin)
      .set('Cookie', oldCookie)
      .send({ email: 'member@example.com', password: goodPassword });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const newCookie = login.headers['set-cookie'][0].split(';', 1)[0];
    const oldSession = await request(app).get('/api/auth/me').set('Cookie', oldCookie);
    const newSession = await request(app).get('/api/auth/me').set('Cookie', newCookie);
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Origin', trustedOrigin)
      .set('Cookie', newCookie);
    const afterLogout = await request(app).get('/api/auth/me').set('Cookie', newCookie);

    expect(me.status).toBe(200);
    expect(login.status).toBe(200);
    expect(oldSession.status).toBe(401);
    expect(newSession.status).toBe(200);
    expect(logout.status).toBe(204);
    expect(logout.headers['set-cookie'][0]).toMatch(/Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
    expect(afterLogout.status).toBe(401);
  });

  it('keeps sessions independently revocable when a second login has no previous cookie', async () => {
    const registered = await register();
    const firstCookie = registered.headers['set-cookie'][0].split(';', 1)[0];
    const secondLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', trustedOrigin)
      .send({ email: 'member@example.com', password: goodPassword });
    const secondCookie = secondLogin.headers['set-cookie'][0].split(';', 1)[0];

    expect(secondLogin.status).toBe(200);
    expect(secondCookie).not.toBe(firstCookie);
    expect((await request(app).get('/api/auth/me').set('Cookie', firstCookie)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', secondCookie)).status).toBe(200);

    const logoutFirst = await request(app)
      .post('/api/auth/logout')
      .set('Origin', trustedOrigin)
      .set('Cookie', firstCookie);

    expect(logoutFirst.status).toBe(204);
    expect((await request(app).get('/api/auth/me').set('Cookie', firstCookie)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', secondCookie)).status).toBe(200);
  });

  it('rate-limits repeated login attempts and returns Retry-After', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () => request(app)
        .post('/api/auth/login')
        .set('Origin', trustedOrigin)
        .send({ email: 'abuse@example.com', password: 'short' })),
    );
    const limited = await request(app)
      .post('/api/auth/login')
      .set('Origin', trustedOrigin)
      .send({ email: 'abuse@example.com', password: 'short' });

    expect(attempts.every((response) => response.status === 400)).toBe(true);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it('does not issue a cookie or expose database details when account persistence fails', async () => {
    const databaseSecret = 'database-password-that-must-not-leak';
    const unavailableRepository = {
      async createUserAndSession() {
        throw new Error(`connection refused for ${databaseSecret}`);
      },
    } as unknown as AuthRepository;
    const unavailableApp = createApp({
      logger,
      appOrigin: trustedOrigin,
      authService: new AuthService(unavailableRepository),
      secureCookie: false,
    });
    const response = await request(unavailableApp)
      .post('/api/auth/register')
      .set('Origin', trustedOrigin)
      .send({ email: 'outage@example.com', password: goodPassword });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain(databaseSecret);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('rejects expired sessions and allows idempotent logout without a session', async () => {
    await register();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'member@example.com' } });
    const token = createSessionToken();
    const now = Date.now();
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        createdAt: new Date(now - 8 * 24 * 60 * 60 * 1_000),
        expiresAt: new Date(now - 24 * 60 * 60 * 1_000),
      },
    });

    const expired = await request(app).get('/api/auth/me').set('Cookie', `tm_session=${token}`);
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Origin', trustedOrigin);

    expect(expired.status).toBe(401);
    expect(logout.status).toBe(204);
  });

  it('deletes only a bounded batch of expired sessions while preserving active sessions', async () => {
    await register();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'member@example.com' } });
    const now = Date.now();
    const expiredTokens = [createSessionToken(), createSessionToken()];
    await prisma.session.createMany({
      data: expiredTokens.map((token) => ({
        userId: user.id,
        tokenHash: hashSessionToken(token),
        createdAt: new Date(now - 2 * 24 * 60 * 60 * 1_000),
        expiresAt: new Date(now - 24 * 60 * 60 * 1_000),
      })),
    });

    const repository = new AuthRepository(prisma);
    const deleted = await repository.deleteExpiredSessionsBatch(1, new Date(now));

    expect(deleted).toBe(1);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
    expect(await prisma.session.count({ where: { userId: user.id, expiresAt: { gt: new Date(now) } } })).toBe(1);
  });

  it('rejects missing, mismatched and non-JSON origins before writing accounts', async () => {
    const missingOrigin = await request(app).post('/api/auth/register').send({ email: 'a@b.co', password: goodPassword });
    const wrongOrigin = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@b.co', password: goodPassword });
    const wrongReferer = await request(app)
      .post('/api/auth/register')
      .set('Referer', 'https://evil.example/register')
      .send({ email: 'a@b.co', password: goodPassword });
    const originWithPath = await request(app)
      .post('/api/auth/register')
      .set('Origin', `${trustedOrigin}/register`)
      .send({ email: 'a@b.co', password: goodPassword });
    const wrongType = await request(app)
      .post('/api/auth/register')
      .set('Origin', trustedOrigin)
      .set('Content-Type', 'text/plain')
      .send('not json');
    const refererFallback = await request(app)
      .post('/api/auth/register')
      .set('Referer', `${trustedOrigin}/register`)
      .send({ email: 'referer@example.com', password: goodPassword });
    const bodylessDelete = await request(app)
      .delete('/api/auth/logout')
      .set('Origin', trustedOrigin);
    const nonJsonDelete = await request(app)
      .delete('/api/auth/logout')
      .set('Origin', trustedOrigin)
      .set('Content-Type', 'text/plain')
      .send('not json');

    expect(missingOrigin.status).toBe(403);
    expect(wrongOrigin.status).toBe(403);
    expect(wrongReferer.status).toBe(403);
    expect(originWithPath.status).toBe(403);
    expect(wrongType.status).toBe(415);
    expect(refererFallback.status).toBe(201);
    expect(bodylessDelete.status).toBe(404);
    expect(nonJsonDelete.status).toBe(415);
    expect(await prisma.user.count()).toBe(1);
  });

  it('does not expose session state for a malformed or missing cookie', async () => {
    const noCookie = await request(app).get('/api/auth/me');
    const malformed = await request(app).get('/api/auth/me').set('Cookie', 'tm_session=invalid');

    expect(noCookie.status).toBe(401);
    expect(malformed.status).toBe(401);
  });

  it('creates a different opaque token for every new session', () => {
    expect(createSessionToken()).not.toBe(createSessionToken());
  });
});
