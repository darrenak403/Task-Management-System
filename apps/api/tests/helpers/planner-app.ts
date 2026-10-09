import type { Express } from 'express';
import type { Logger } from 'pino';
import { createApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { AuthRepository } from '../../src/modules/auth/auth.repository.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { GeminiCredentialRepository } from '../../src/modules/ai-credentials/credentials.repository.js';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service.js';
import { PlannerContextService } from '../../src/modules/planner/context.service.js';
import { AiJobRunner } from '../../src/modules/planner/job-runner.js';
import { AiJobService } from '../../src/modules/planner/job.service.js';
import { AiPlanVersionService } from '../../src/modules/planner/version.service.js';
import { AiPlanConfirmService } from '../../src/modules/planner/confirm.service.js';
import { TaskDependencyService } from '../../src/modules/tasks/dependency.service.js';
import type { PlannerProvider } from '../../src/modules/planner/provider.types.js';
import { TaskService } from '../../src/modules/tasks/task.service.js';
import { TeamService } from '../../src/modules/teams/team.service.js';
import { WorkspaceService } from '../../src/modules/workspaces/workspace.service.js';
import { parseEnvironment, type RuntimeEnvironment } from '../../src/shared/config/env.js';

export const plannerTestKeyring = {
  activeVersion: 'planner-test-v1',
  key: Buffer.alloc(32, 81),
};

export function createPlannerTestEnvironment(): RuntimeEnvironment {
  return parseEnvironment({
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://localhost:3000',
    AI_ENABLED: 'true',
    CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: plannerTestKeyring.activeVersion,
    CREDENTIAL_ENCRYPTION_KEYRING: JSON.stringify({ [plannerTestKeyring.activeVersion]: plannerTestKeyring.key.toString('base64') }),
    AI_MAX_INPUT_TOKENS: '50000',
    AI_MAX_OUTPUT_TOKENS: '10000',
    AI_PROVIDER_TIMEOUT_MS: '1000',
    AI_JOB_TIMEOUT_MS: '10000',
  });
}

export function createPlannerTestApp(input: {
  prisma: PrismaClient;
  logger: Logger;
  environment: RuntimeEnvironment;
  provider: PlannerProvider;
}): {
  app: Express;
  runner: AiJobRunner;
  service: AiJobService;
  contextService: PlannerContextService;
  credentialRepository: GeminiCredentialRepository;
} {
  const authService = new AuthService(new AuthRepository(input.prisma));
  const credentialRepository = new GeminiCredentialRepository(input.prisma);
  const contextService = new PlannerContextService(input.prisma);
  const versionService = new AiPlanVersionService(input.prisma, contextService, input.environment);
  const confirmService = new AiPlanConfirmService(input.prisma, contextService);
  const runner = new AiJobRunner(
    input.prisma,
    input.environment,
    credentialRepository,
    contextService,
    input.provider,
    input.logger,
  );
  const service = new AiJobService(
    input.prisma,
    input.environment,
    credentialRepository,
    contextService,
    () => runner.wake(),
    (jobId) => runner.abortJob(jobId),
  );
  const app = createApp({
    logger: input.logger,
    appOrigin: input.environment.APP_ORIGIN,
    authService,
    workspaceService: new WorkspaceService(input.prisma),
    teamService: new TeamService(input.prisma),
    taskService: new TaskService(input.prisma),
    taskDependencyService: new TaskDependencyService(input.prisma, contextService),
    dashboardService: new DashboardService(input.prisma),
    plannerService: service,
    plannerVersionService: versionService,
    plannerConfirmService: confirmService,
  });
  return { app, runner, service, contextService, credentialRepository };
}
