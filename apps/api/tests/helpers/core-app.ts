import type { Express } from 'express';
import type { Logger } from 'pino';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { AuthRepository } from '../../src/modules/auth/auth.repository.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service.js';
import { TaskService } from '../../src/modules/tasks/task.service.js';
import { TaskDependencyService } from '../../src/modules/tasks/dependency.service.js';
import { PlannerContextService } from '../../src/modules/planner/context.service.js';
import { TeamService } from '../../src/modules/teams/team.service.js';
import { WorkspaceService } from '../../src/modules/workspaces/workspace.service.js';
import { RealtimeService } from '../../src/modules/realtime/realtime.service.js';
import type { RealtimeConnectionRegistry } from '../../src/modules/realtime/connection-registry.js';

export const trustedTestOrigin = 'http://localhost:3000';

export function createCoreTestApp(prisma: PrismaClient, logger: Logger): Express {
  return createApp({
    logger,
    appOrigin: trustedTestOrigin,
    authService: new AuthService(new AuthRepository(prisma)),
    workspaceService: new WorkspaceService(prisma),
    teamService: new TeamService(prisma),
    taskService: new TaskService(prisma),
    taskDependencyService: new TaskDependencyService(prisma, new PlannerContextService(prisma)),
    dashboardService: new DashboardService(prisma),
  });
}

export function createRealtimeCoreTestApp(prisma: PrismaClient, logger: Logger, connections: RealtimeConnectionRegistry) {
  const authService = new AuthService(new AuthRepository(prisma));
  const realtimeService = new RealtimeService(prisma, authService, connections);
  const app = createApp({
    logger,
    appOrigin: trustedTestOrigin,
    authService,
    workspaceService: new WorkspaceService(prisma),
    teamService: new TeamService(prisma),
    taskService: new TaskService(prisma),
    taskDependencyService: new TaskDependencyService(prisma, new PlannerContextService(prisma)),
    dashboardService: new DashboardService(prisma),
    realtimeService,
  });
  return { app, authService, realtimeService };
}

export async function registerTestUser(app: Express, email: string): Promise<{ id: string; cookie: string }> {
  const response = await request(app)
    .post('/api/auth/register')
    .set('Origin', trustedTestOrigin)
    .send({ email, password: 'valid-passphrase-123', displayName: email.split('@')[0] });
  if (response.status !== 201) throw new Error(`Expected test user registration to return 201; received ${response.status}`);
  return {
    id: response.body.data.id as string,
    cookie: response.headers['set-cookie'][0].split(';', 1)[0],
  };
}

export async function createTestWorkspace(app: Express, cookie: string, name = 'Test workspace') {
  const response = await request(app)
    .post('/api/workspaces')
    .set('Origin', trustedTestOrigin)
    .set('Cookie', cookie)
    .send({ name });
  if (response.status !== 201) throw new Error(`Expected workspace creation to return 201; received ${response.status}`);
  return response.body.data as { id: string; name: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' };
}
