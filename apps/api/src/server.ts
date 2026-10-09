import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import dotenv from 'dotenv';
import { createApp } from './app.js';
import { loadEnvironment } from './shared/config/env.js';
import { createLogger } from './shared/logging/logger.js';
import { createPrismaClient } from './shared/db/prisma.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import { AuthService } from './modules/auth/auth.service.js';
import { GeminiCredentialRepository } from './modules/ai-credentials/credentials.repository.js';
import {
  GeminiCredentialService,
  GoogleGeminiCredentialVerifier,
} from './modules/ai-credentials/credentials.service.js';
import { WorkspaceService } from './modules/workspaces/workspace.service.js';
import { TeamService } from './modules/teams/team.service.js';
import { TaskService } from './modules/tasks/task.service.js';
import { DashboardService } from './modules/dashboard/dashboard.service.js';
import { RealtimeConnectionRegistry } from './modules/realtime/connection-registry.js';
import { RealtimeDispatcher } from './modules/realtime/dispatcher.js';
import { RealtimeService } from './modules/realtime/realtime.service.js';
import { PlannerContextService } from './modules/planner/context.service.js';
import { AiJobService } from './modules/planner/job.service.js';
import { AiPlanVersionService } from './modules/planner/version.service.js';
import { AiPlanConfirmService } from './modules/planner/confirm.service.js';
import { TaskDependencyService } from './modules/tasks/dependency.service.js';
import { AiJobRunner } from './modules/planner/job-runner.js';
import { GeminiPlannerProvider } from './modules/planner/gemini.adapter.js';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const environment = loadEnvironment();
const logger = createLogger(environment);
if (!environment.DATABASE_URL) {
  logger.fatal('DATABASE_URL is required to start the API server');
  process.exit(1);
}

const prisma = createPrismaClient(environment.DATABASE_URL);
const authService = new AuthService(new AuthRepository(prisma));
const credentialRepository = new GeminiCredentialRepository(prisma);
const workspaceService = new WorkspaceService(prisma);
const teamService = new TeamService(prisma);
const taskService = new TaskService(prisma);
const dashboardService = new DashboardService(prisma);
const realtimeConnections = new RealtimeConnectionRegistry();
const realtimeDispatcher = new RealtimeDispatcher(prisma, environment.DATABASE_URL, realtimeConnections, logger);
const realtimeService = new RealtimeService(prisma, authService, realtimeConnections);
const plannerContext = new PlannerContextService(prisma);
const taskDependencyService = new TaskDependencyService(prisma, plannerContext);
const plannerVersionService = new AiPlanVersionService(prisma, plannerContext, environment);
const plannerConfirmService = new AiPlanConfirmService(prisma, plannerContext);
const aiJobRunner = new AiJobRunner(
  prisma,
  environment,
  credentialRepository,
  plannerContext,
  new GeminiPlannerProvider(environment),
  logger,
);
const credentialService = new GeminiCredentialService(
  credentialRepository,
  environment,
  new GoogleGeminiCredentialVerifier(),
  (userId) => aiJobRunner.abortUserJobs(userId),
);
const aiJobService = new AiJobService(
  prisma,
  environment,
  credentialRepository,
  plannerContext,
  () => aiJobRunner.wake(),
  (jobId) => aiJobRunner.abortJob(jobId),
);
realtimeDispatcher.subscribeToWake(() => aiJobRunner.wake());
const app = createApp({
  logger,
  appOrigin: environment.APP_ORIGIN,
  secureCookie: environment.NODE_ENV === 'production',
  appBuildSha: process.env.APP_BUILD_SHA,
  trustedProxyCidrs: environment.TRUSTED_PROXY_CIDRS,
  readinessProbe: async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return realtimeDispatcher.isAvailable() && !isShuttingDown;
    } catch {
      return false;
    }
  },
  authService,
  credentialService,
  workspaceService,
  teamService,
  taskService,
  taskDependencyService,
  dashboardService,
  realtimeService,
  plannerService: aiJobService,
  plannerVersionService,
  plannerConfirmService,
});
const server: Server = createServer(app);

let isListening = false;
let isShuttingDown = false;

const start = async (): Promise<void> => {
  await prisma.$connect();
  await realtimeDispatcher.start();
  await aiJobRunner.start();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(environment.PORT, '0.0.0.0', () => {
      isListening = true;
      resolve();
    });
  });
  logger.info({ port: environment.PORT }, 'API server started');
};

const shutdown = (signal: NodeJS.Signals): void => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'API server is draining');

  const deadline = setTimeout(() => {
    logger.error({ signal }, 'API server drain deadline exceeded');
    process.exit(1);
  }, 30_000);
  deadline.unref();

  const serverClosed = isListening
    ? new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    : Promise.resolve();
  void (async () => {
    try {
      await realtimeDispatcher.stop();
      await aiJobRunner.stop();
      await serverClosed;
      await prisma.$disconnect();
      logger.info({ signal }, 'API server stopped');
      process.exitCode = 0;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      logger.error({ signal, errorName }, 'API server failed to close cleanly');
      await prisma.$disconnect().catch(() => undefined);
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  })();
};

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

void start().catch((error: unknown) => {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  logger.fatal({ errorName }, 'API startup failed');
  void realtimeDispatcher.stop().catch(() => undefined)
    .then(() => aiJobRunner.stop())
    .then(() => prisma.$disconnect()).catch(() => undefined).finally(() => {
    process.exitCode = 1;
  });
});
