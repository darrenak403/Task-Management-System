import { Router } from 'express';
import { createRateLimit } from '../../shared/http/rate-limit.js';
import { currentUserId } from '../auth/auth.policy.js';
import { createSessionMiddleware } from '../auth/session.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import type { AiJobService } from './job.service.js';
import type { AiPlanVersionService } from './version.service.js';
import type { AiPlanConfirmService } from './confirm.service.js';
import { createPlannerController } from './planner.controller.js';

export function createPlannerRoutes(authService: AuthService, service: AiJobService, versions: AiPlanVersionService, confirms: AiPlanConfirmService): Router {
  const router = Router({ mergeParams: true });
  const controller = createPlannerController(service, versions, confirms);
  const session = createSessionMiddleware(authService);
  const writeLimiter = createRateLimit({
    limit: 10,
    windowMs: 60_000,
    key: (request) => `ai-planner:${request.auth?.user.id ?? currentUserId(request)}`,
  });

  router.use(session);
  router.get('/ai-plans', controller.listPlans);
  router.post('/ai-plans', writeLimiter, controller.create);
  router.get('/ai-plans/:planId', controller.getPlan);
  router.post('/ai-plans/:planId/generate', writeLimiter, controller.generate);
  router.post('/ai-plans/:planId/confirm', writeLimiter, controller.confirm);
  router.post('/ai-plans/:planId/clone', writeLimiter, controller.clone);
  router.get('/ai-plans/:planId/versions', controller.listVersions);
  router.post('/ai-plans/:planId/versions', writeLimiter, controller.saveVersion);
  router.get('/ai-plans/:planId/versions/:versionId', controller.getVersion);
  router.post('/ai-plans/:planId/versions/:versionId/activate', writeLimiter, controller.activateVersion);
  router.get('/ai-jobs', controller.findJob);
  router.get('/ai-jobs/:jobId', controller.getJob);
  router.post('/ai-jobs/:jobId/clarify', writeLimiter, controller.clarify);
  router.post('/ai-jobs/:jobId/cancel', writeLimiter, controller.cancel);
  return router;
}
