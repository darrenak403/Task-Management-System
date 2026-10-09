import { Router } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import { createSessionMiddleware } from '../auth/session.middleware.js';
import { createTeamController } from './team.controller.js';
import type { TeamService } from './team.service.js';

export function createTeamRoutes(authService: AuthService, service: TeamService): Router {
  const router = Router({ mergeParams: true });
  const controller = createTeamController(service);
  router.use(createSessionMiddleware(authService));

  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:teamId/members', controller.listMembers);
  router.post('/:teamId/members', controller.addMember);
  router.delete('/:teamId/members/:userId', controller.removeMember);
  router.get('/:teamId', controller.get);
  router.patch('/:teamId', controller.update);

  return router;
}
