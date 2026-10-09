import { Router } from 'express';
import type { Logger } from 'pino';
import { createRealtimeController } from './realtime.controller.js';
import type { RealtimeService } from './realtime.service.js';

export function createRealtimeRoutes(service: RealtimeService, appOrigin: string, logger: Logger): Router {
  const router = Router();
  router.get('/events', createRealtimeController(service, appOrigin, logger));
  return router;
}
