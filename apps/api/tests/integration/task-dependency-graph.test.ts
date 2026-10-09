import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPlannerTestApp, createPlannerTestEnvironment } from '../helpers/planner-app.js';
import { createTestDatabase, resetTestDatabase } from '../helpers/db.js';
import { createTestWorkspace, registerTestUser, trustedTestOrigin } from '../helpers/core-app.js';
import { FakeGeminiProvider } from '../fakes/fake-gemini.js';

const prisma: PrismaClient = createTestDatabase();
const logger = pino({ level: 'silent' });
const environment = createPlannerTestEnvironment();

type Scope = { workspaceId: string; teamId: string };

let fixture: ReturnType<typeof createPlannerTestApp>;

beforeAll(async () => prisma.$connect());

beforeEach(async () => {
  await resetTestDatabase(prisma);
  fixture = createPlannerTestApp({
    prisma,
    logger,
    environment,
    provider: new FakeGeminiProvider(),
  });
});

afterAll(async () => {
  await fixture.runner.stop();
  await prisma.$disconnect();
  await logger.flush();
});

function tasksPath(scope: Scope, taskId = ''): string {
  return `/api/workspaces/${scope.workspaceId}/teams/${scope.teamId}/tasks${taskId ? `/${taskId}` : ''}`;
}

async function createTask(scope: Scope, cookie: string, title: string) {
  const response = await request(fixture.app)
    .post(tasksPath(scope))
    .set('Origin', trustedTestOrigin)
    .set('Cookie', cookie)
    .send({ title });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data as { id: string; updatedAt: string; dependencies: { prerequisites: string[]; dependents: string[] } };
}

async function replacePrerequisites(scope: Scope, cookie: string, task: { id: string; updatedAt: string }, prerequisiteIds: string[]) {
  return request(fixture.app)
    .patch(tasksPath(scope, `${task.id}/dependencies`))
    .set('Origin', trustedTestOrigin)
    .set('Cookie', cookie)
    .send({ prerequisiteIds, expectedUpdatedAt: task.updatedAt });
}

describe('same-team task dependency graph', () => {
  it('accepts a DAG, rejects self/cross-team/cyclic or stale updates, and protects prerequisites from deletion', async () => {
    const owner = await registerTestUser(fixture.app, 'dependency-graph@example.com');
    const workspace = await createTestWorkspace(fixture.app, owner.cookie, 'Dependency graph workspace');
    const firstTeamResponse = await request(fixture.app)
      .post(`/api/workspaces/${workspace.id}/teams`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ name: 'Core team' });
    const otherTeamResponse = await request(fixture.app)
      .post(`/api/workspaces/${workspace.id}/teams`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ name: 'Other team' });
    expect(firstTeamResponse.status).toBe(201);
    expect(otherTeamResponse.status).toBe(201);
    const scope: Scope = { workspaceId: workspace.id, teamId: firstTeamResponse.body.data.id as string };
    const otherScope: Scope = { workspaceId: workspace.id, teamId: otherTeamResponse.body.data.id as string };
    const taskA = await createTask(scope, owner.cookie, 'Task A');
    const taskB = await createTask(scope, owner.cookie, 'Task B');
    const taskC = await createTask(scope, owner.cookie, 'Task C');
    const crossTeamTask = await createTask(otherScope, owner.cookie, 'Task in another team');
    await new Promise((resolve) => setTimeout(resolve, 3));

    const aDependsOnB = await replacePrerequisites(scope, owner.cookie, taskA, [taskB.id]);
    expect(aDependsOnB.status, JSON.stringify(aDependsOnB.body)).toBe(200);
    const bDependsOnC = await replacePrerequisites(scope, owner.cookie, taskB, [taskC.id]);
    expect(bDependsOnC.status, JSON.stringify(bDependsOnC.body)).toBe(200);

    const selfDependency = await replacePrerequisites(scope, owner.cookie, taskC, [taskC.id]);
    const crossTeamDependency = await replacePrerequisites(
      scope,
      owner.cookie,
      { id: taskA.id, updatedAt: aDependsOnB.body.data.updatedAt as string },
      [crossTeamTask.id],
    );
    const cycle = await replacePrerequisites(scope, owner.cookie, taskC, [taskA.id]);
    const duplicateIds = await request(fixture.app)
      .patch(tasksPath(scope, `${taskC.id}/dependencies`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ prerequisiteIds: [taskA.id, taskA.id], expectedUpdatedAt: bDependsOnC.body.data.updatedAt });
    const stale = await replacePrerequisites(scope, owner.cookie, taskA, []);
    const protectedDelete = await request(fixture.app)
      .delete(tasksPath(scope, taskB.id))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie);
    const currentA = await request(fixture.app).get(tasksPath(scope, taskA.id)).set('Cookie', owner.cookie);
    const currentB = await request(fixture.app).get(tasksPath(scope, taskB.id)).set('Cookie', owner.cookie);

    expect(selfDependency.status).toBe(422);
    expect(selfDependency.body.error.code).toBe('DEPENDENCY_CYCLE');
    expect(crossTeamDependency.status).toBe(422);
    expect(crossTeamDependency.body.error.code).toBe('INVALID_DEPENDENCY');
    expect(cycle.status).toBe(422);
    expect(cycle.body.error.code).toBe('DEPENDENCY_CYCLE');
    expect(duplicateIds.status).toBe(400);
    expect(duplicateIds.body.error.code).toBe('VALIDATION_ERROR');
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('TASK_VERSION_CONFLICT');
    expect(protectedDelete.status).toBe(409);
    expect(protectedDelete.body.error.code).toBe('TASK_HAS_DEPENDENTS');
    expect(currentA.body.data.dependencies).toEqual({ prerequisites: [taskB.id], dependents: [] });
    expect(currentB.body.data.dependencies).toEqual({ prerequisites: [taskC.id], dependents: [taskA.id] });
    expect(await prisma.taskDependency.count()).toBe(2);

    const deleteDependent = await request(fixture.app)
      .delete(tasksPath(scope, taskA.id))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie);
    const deleteMiddle = await request(fixture.app)
      .delete(tasksPath(scope, taskB.id))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie);
    const deletePrerequisite = await request(fixture.app)
      .delete(tasksPath(scope, taskC.id))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie);
    expect(deleteDependent.status).toBe(204);
    expect(deleteMiddle.status).toBe(204);
    expect(deletePrerequisite.status).toBe(204);
    expect(await prisma.taskDependency.count()).toBe(0);
  });
});
