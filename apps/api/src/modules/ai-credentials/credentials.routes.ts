import { Router } from 'express';
import { createRateLimit } from '../../shared/http/rate-limit.js';
import { currentUserId } from '../auth/auth.policy.js';
import { createSessionMiddleware } from '../auth/session.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { createGeminiCredentialController } from './credentials.controller.js';
import type { GeminiCredentialService } from './credentials.service.js';

export function createGeminiCredentialRoutes(
  authService: AuthService,
  credentialService: GeminiCredentialService,
): Router {
  const router = Router();
  const controller = createGeminiCredentialController(credentialService);
  const session = createSessionMiddleware(authService);
  const writeLimiter = createRateLimit({
    limit: 5,
    windowMs: 15 * 60 * 1_000,
    key: (request) => `gemini-credential:${request.auth?.user.id ?? currentUserId(request)}`,
  });

  router.get('/gemini', session, controller.get);
  router.put('/gemini', session, writeLimiter, controller.put);
  router.patch('/gemini', session, writeLimiter, controller.updateModel);
  router.delete('/gemini', session, writeLimiter, controller.remove);
  return router;
}
