import { Router } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import { createSessionMiddleware } from '../auth/session.middleware.js';
import { createTaskController } from './task.controller.js';
import type { TaskService } from './task.service.js';
import type { TaskDependencyService } from './dependency.service.js';

export function createWorkspaceTaskRoutes(authService: AuthService, service: TaskService): Router {
  const router = Router({ mergeParams: true });
  const controller = createTaskController(service);
  router.use(createSessionMiddleware(authService));
  router.get('/', controller.list);
  return router;
}

export function createTeamTaskRoutes(authService: AuthService, service: TaskService, dependencyService?: TaskDependencyService): Router {
  const router = Router({ mergeParams: true });
  const controller = createTaskController(service);
  router.use(createSessionMiddleware(authService));
  router.post('/', controller.create);
  router.get('/:taskId', controller.get);
  router.patch('/:taskId', controller.update);
  if (dependencyService) router.patch('/:taskId/dependencies', controller.replaceDependencies(dependencyService));
  router.delete('/:taskId', controller.remove);
  return router;
}
