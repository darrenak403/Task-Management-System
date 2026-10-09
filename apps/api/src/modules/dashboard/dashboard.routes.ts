import { Router } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/auth.service.js';
import { createSessionMiddleware, requireAuthenticated } from '../auth/session.middleware.js';
import { parseInput } from '../../shared/http/pagination.js';
import type { DashboardService } from './dashboard.service.js';

const paramsSchema = z.object({ workspaceId: z.uuid() }).strict();
const querySchema = z.object({ teamId: z.uuid().optional() }).strict();

export function createDashboardRoutes(authService: AuthService, service: DashboardService): Router {
  const router = Router({ mergeParams: true });
  router.use(createSessionMiddleware(authService));
  router.get('/', async (request, response) => {
    const { workspaceId } = parseInput(paramsSchema, request.params);
    const { teamId } = parseInput(querySchema, request.query);
    response.status(200).json(await service.get(requireAuthenticated(request).user.id, workspaceId, teamId));
  });
  return router;
}
