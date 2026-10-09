import { Router } from 'express';
import { createRateLimit, hashRateLimitIdentifier } from '../../shared/http/rate-limit.js';
import type { AuthService } from './auth.service.js';
import { createSessionMiddleware } from './session.middleware.js';
import { createAuthController } from './auth.controller.js';
import type { Logger } from 'pino';

export function createAuthRoutes(service: AuthService, secureCookie: boolean, logger: Logger): Router {
  const router = Router();
  const controller = createAuthController(service, secureCookie, logger);
  const registerLimiter = createRateLimit({
    limit: 5,
    windowMs: 15 * 60 * 1_000,
    key: (request) => `register:${request.ip ?? 'unknown'}`,
  });
  const loginLimiter = createRateLimit({
    limit: 10,
    windowMs: 15 * 60 * 1_000,
    key: (request) => {
      const email = typeof request.body?.email === 'string' ? request.body.email : '';
      return `login:${request.ip ?? 'unknown'}:${hashRateLimitIdentifier(email)}`;
    },
  });

  router.post('/register', registerLimiter, controller.register);
  router.post('/login', loginLimiter, controller.login);
  router.post('/logout', controller.logout);
  router.get('/me', createSessionMiddleware(service), controller.me);
  return router;
}
