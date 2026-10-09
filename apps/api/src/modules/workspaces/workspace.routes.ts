import { Router } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import { createSessionMiddleware } from '../auth/session.middleware.js';
import { createWorkspaceController } from './workspace.controller.js';
import type { WorkspaceService } from './workspace.service.js';

export function createWorkspaceRoutes(authService: AuthService, service: WorkspaceService): Router {
  const router = Router();
  const controller = createWorkspaceController(service);
  router.use(createSessionMiddleware(authService));

  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:workspaceId/members', controller.listMembers);
  router.post('/:workspaceId/members', controller.addMember);
  router.patch('/:workspaceId/members/:userId', controller.updateMember);
  router.delete('/:workspaceId/members/:userId', controller.removeMember);
  router.get('/:workspaceId', controller.get);
  router.patch('/:workspaceId', controller.update);

  return router;
}
