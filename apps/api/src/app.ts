import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { createOriginGuard } from './shared/http/origin-guard.js';
import { createRateLimit } from './shared/http/rate-limit.js';
import { createErrorHandler, notFoundHandler } from './shared/http/error-handler.js';
import { requestIdMiddleware } from './shared/http/request-id.js';
import { createHealthRoutes, type ReadinessProbe } from './modules/health/health.routes.js';
import { createOpenApiRoutes } from './modules/openapi/openapi.routes.js';
import type { AuthService } from './modules/auth/auth.service.js';
import { createAuthRoutes } from './modules/auth/auth.routes.js';
import type { GeminiCredentialService } from './modules/ai-credentials/credentials.service.js';
import { createGeminiCredentialRoutes } from './modules/ai-credentials/credentials.routes.js';
import type { WorkspaceService } from './modules/workspaces/workspace.service.js';
import { createWorkspaceRoutes } from './modules/workspaces/workspace.routes.js';
import type { TeamService } from './modules/teams/team.service.js';
import { createTeamRoutes } from './modules/teams/team.routes.js';
import type { TaskService } from './modules/tasks/task.service.js';
import { createTeamTaskRoutes, createWorkspaceTaskRoutes } from './modules/tasks/task.routes.js';
import type { TaskDependencyService } from './modules/tasks/dependency.service.js';
import type { DashboardService } from './modules/dashboard/dashboard.service.js';
import { createDashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import type { RealtimeService } from './modules/realtime/realtime.service.js';
import { createRealtimeRoutes } from './modules/realtime/realtime.routes.js';
import type { AiJobService } from './modules/planner/job.service.js';
import type { AiPlanVersionService } from './modules/planner/version.service.js';
import type { AiPlanConfirmService } from './modules/planner/confirm.service.js';
import { createPlannerRoutes } from './modules/planner/planner.routes.js';

export type AppDependencies = {
  readinessProbe?: ReadinessProbe;
  logger: Logger;
  appOrigin?: string;
  secureCookie?: boolean;
  appBuildSha?: string | undefined;
  trustedProxyCidrs?: readonly string[];
  authService?: AuthService;
  credentialService?: GeminiCredentialService;
  workspaceService?: WorkspaceService;
  teamService?: TeamService;
  taskService?: TaskService;
  taskDependencyService?: TaskDependencyService;
  dashboardService?: DashboardService;
  realtimeService?: RealtimeService;
  plannerService?: AiJobService;
  plannerVersionService?: AiPlanVersionService;
  plannerConfirmService?: AiPlanConfirmService;
};

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  const trustedProxyCidrs = dependencies.trustedProxyCidrs ?? [];
  app.set('trust proxy', trustedProxyCidrs.length > 0 ? [...trustedProxyCidrs] : false);
  app.use(requestIdMiddleware);
  app.use(helmet());

  const api = express.Router();
  api.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(createHealthRoutes(dependencies.readinessProbe, dependencies.appBuildSha));
  api.use(createOpenApiRoutes());
  api.use(createOriginGuard(dependencies.appOrigin ?? 'http://localhost:3000'));
  api.use(
    createRateLimit({
      limit: 120,
      windowMs: 60_000,
      methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
      key: (request) => `api-mutation:${request.ip ?? 'unknown'}`,
    }),
  );
  api.use((request, response, next) => {
    const isPlannerRequest = /^\/workspaces\/[^/]+\/teams\/[^/]+\/(?:ai-plans|ai-jobs|ai-planner)(?:\/|$)/.test(request.path);
    express.json({ limit: isPlannerRequest ? '256kb' : '32kb', strict: true })(request, response, next);
  });
  if (dependencies.realtimeService) {
    api.use('/realtime', createRealtimeRoutes(dependencies.realtimeService, dependencies.appOrigin ?? 'http://localhost:3000', dependencies.logger));
  }
  if (dependencies.authService) {
    api.use('/auth', createAuthRoutes(dependencies.authService, dependencies.secureCookie ?? false, dependencies.logger));
    if (dependencies.credentialService) {
      api.use(
        '/me/ai-provider-credentials',
        createGeminiCredentialRoutes(dependencies.authService, dependencies.credentialService),
      );
    }
    if (dependencies.workspaceService) {
      api.use('/workspaces', createWorkspaceRoutes(dependencies.authService, dependencies.workspaceService));
    }
    if (dependencies.teamService) {
      api.use('/workspaces/:workspaceId/teams', createTeamRoutes(dependencies.authService, dependencies.teamService));
    }
    if (dependencies.taskService) {
      api.use('/workspaces/:workspaceId/tasks', createWorkspaceTaskRoutes(dependencies.authService, dependencies.taskService));
      api.use('/workspaces/:workspaceId/teams/:teamId/tasks', createTeamTaskRoutes(dependencies.authService, dependencies.taskService, dependencies.taskDependencyService));
    }
    if (dependencies.dashboardService) {
      api.use('/workspaces/:workspaceId/dashboard', createDashboardRoutes(dependencies.authService, dependencies.dashboardService));
    }
    if (dependencies.plannerService && dependencies.plannerVersionService && dependencies.plannerConfirmService) {
      api.use('/workspaces/:workspaceId/teams/:teamId', createPlannerRoutes(dependencies.authService, dependencies.plannerService, dependencies.plannerVersionService, dependencies.plannerConfirmService));
    }
  }
  app.use('/api', api);

  app.use(notFoundHandler());
  app.use(createErrorHandler(dependencies.logger));
  return app;
}
