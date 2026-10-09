import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { createApp } from '../../src/app.js';

const logger = pino({ level: 'silent' });
const app = createApp({ logger });

afterAll(async () => {
  await logger.flush();
});

describe('API foundation', () => {
  it('serves liveness through the app factory', async () => {
    const response = await request(app).get('/api/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('returns unavailable when readiness dependencies fail', async () => {
    const unavailableApp = createApp({ logger, readinessProbe: async () => false });
    const response = await request(unavailableApp).get('/api/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'unavailable' });
  });

  it('returns ready when the readiness probe succeeds', async () => {
    const readyApp = createApp({ logger, readinessProbe: async () => true });
    const response = await request(readyApp).get('/api/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('fails readiness closed when the readiness probe throws', async () => {
    const unavailableApp = createApp({
      logger,
      readinessProbe: async () => {
        throw new Error('database connection details must not be returned');
      },
    });
    const response = await request(unavailableApp).get('/api/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(response.body)).not.toContain('database connection details');
  });

  it('reports a valid release SHA on liveness and readiness responses, including unavailable readiness', async () => {
    const releaseSha = 'A'.repeat(40);
    const releaseApp = createApp({ logger, appBuildSha: releaseSha, readinessProbe: async () => false });

    const live = await request(releaseApp).get('/api/health/live');
    const ready = await request(releaseApp).get('/api/health/ready');

    expect(live.status).toBe(200);
    expect(live.headers['x-release-sha']).toBe(releaseSha);
    expect(ready.status).toBe(503);
    expect(ready.headers['x-release-sha']).toBe(releaseSha);
  });

  it('omits the release header when the configured build identifier is not a 40–64 character SHA', async () => {
    const invalidReleaseApp = createApp({ logger, appBuildSha: 'main-20261009' });

    const response = await request(invalidReleaseApp).get('/api/health/live');

    expect(response.status).toBe(200);
    expect(response.headers['x-release-sha']).toBeUndefined();
  });

  it('sets security headers and a fresh request ID on each response', async () => {
    const first = await request(app).get('/api/health/live');
    const second = await request(app).get('/api/health/live');

    expect(first.headers['x-powered-by']).toBeUndefined();
    expect(first.headers['x-content-type-options']).toBe('nosniff');
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('serves the OpenAPI contract and stable JSON for missing routes', async () => {
    const contract = await request(app).get('/api/openapi.json');
    const missing = await request(app).get('/api/does-not-exist');

    expect(contract.status).toBe(200);
    expect(contract.body.openapi).toBe('3.1.0');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect(missing.body.error.requestId).toBe(missing.headers['x-request-id']);
  });

  it('maps malformed and oversized JSON into safe client errors', async () => {
    const malformed = await request(app)
      .post('/api/does-not-exist')
      .set('Origin', 'http://localhost:3000')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    const oversized = await request(app)
      .post('/api/does-not-exist')
      .set('Origin', 'http://localhost:3000')
      .send({ value: 'x'.repeat(33 * 1024) });

    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
