import express from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import request from 'supertest';
import { z } from 'zod';
import { createErrorHandler, HttpError } from '../../src/shared/http/error-handler.js';
import { requestIdMiddleware } from '../../src/shared/http/request-id.js';

const logger = pino({ level: 'silent' });

afterAll(async () => {
  await logger.flush();
});

function createErrorApp(error: unknown) {
  const app = express();
  app.use(requestIdMiddleware);
  app.get('/failure', (_request, _response, next) => next(error));
  app.use(createErrorHandler(logger));
  return app;
}

describe('HTTP error envelope', () => {
  it('maps typed HTTP errors to their status and stable envelope', async () => {
    const response = await request(createErrorApp(new HttpError(403, 'FORBIDDEN', 'Access denied.'))).get('/failure');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied.',
        requestId: response.headers['x-request-id'],
      },
    });
  });

  it('maps schema errors to a generic validation response', async () => {
    const secret = 'test-secret-validation-input';
    let validationError: unknown;
    try {
      z.number().parse(secret);
    } catch (error) {
      validationError = error;
    }

    const response = await request(createErrorApp(validationError)).get('/failure');

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'The request is invalid.',
    });
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });

  it('hides unexpected error details and includes the request ID', async () => {
    const response = await request(createErrorApp(new Error('database password=do-not-leak'))).get('/failure');

    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId: response.headers['x-request-id'],
    });
    expect(JSON.stringify(response.body)).not.toContain('do-not-leak');
  });
});
