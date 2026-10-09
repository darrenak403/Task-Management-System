import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { createCoreTestApp, createTestWorkspace, registerTestUser, trustedTestOrigin } from '../helpers/core-app.js';
import { createTestDatabase, resetTestDatabase } from '../helpers/db.js';

const prisma = createTestDatabase();
const logger = pino({ level: 'silent' });
let app = createCoreTestApp(prisma, logger);

beforeAll(async () => { await prisma.$connect(); });
beforeEach(async () => {
  await resetTestDatabase(prisma);
  app = createCoreTestApp(prisma, logger);
});
afterAll(async () => {
  await prisma.$disconnect();
  await logger.flush();
});

async function createAssignedTask() {
  const owner = await registerTestUser(app, 'owner@example.com');
  const assignee = await registerTestUser(app, 'assignee@example.com');
  const workspace = await createTestWorkspace(app, owner.cookie);
  await request(app)
    .post(`/api/workspaces/${workspace.id}/members`)
    .set('Origin', trustedTestOrigin)
    .set('Cookie', owner.cookie)
    .send({ email: 'assignee@example.com' });
  const teamResponse = await request(app)
    .post(`/api/workspaces/${workspace.id}/teams`)
    .set('Origin', trustedTestOrigin)
    .set('Cookie', owner.cookie)
    .send({ name: 'Backend' });
  const teamId = teamResponse.body.data.id as string;
  await request(app)
    .post(`/api/workspaces/${workspace.id}/teams/${teamId}/members`)
    .set('Origin', trustedTestOrigin)
    .set('Cookie', owner.cookie)
    .send({ userId: assignee.id });
  const taskResponse = await request(app)
    .post(`/api/workspaces/${workspace.id}/teams/${teamId}/tasks`)
    .set('Origin', trustedTestOrigin)
    .set('Cookie', owner.cookie)
    .send({ title: 'Assignment race', assigneeId: assignee.id });

  expect(teamResponse.status).toBe(201);
  expect(taskResponse.status).toBe(201);
  return { owner, assignee, workspace, teamId, taskId: taskResponse.body.data.id as string };
}

async function assignAgain(input: { owner: { cookie: string }; workspace: { id: string }; teamId: string; taskId: string; assigneeId: string }) {
  return request(app)
    .patch(`/api/workspaces/${input.workspace.id}/teams/${input.teamId}/tasks/${input.taskId}`)
    .set('Origin', trustedTestOrigin)
    .set('Cookie', input.owner.cookie)
    .send({ assigneeId: input.assigneeId });
}

function expectAssignmentRaceOutcome(status: number, body: { error?: { code?: string } }): void {
  expect([200, 400]).toContain(status);
  if (status === 400) expect(body.error?.code).toBe('INVALID_ASSIGNEE');
}

describe('membership revocation races', () => {
  it('serializes team addition against workspace-member revocation', async () => {
    const fixture = await createAssignedTask();
    const newMember = await registerTestUser(app, 'new-member@example.com');
    const addedToWorkspace = await request(app)
      .post(`/api/workspaces/${fixture.workspace.id}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', fixture.owner.cookie)
      .send({ email: 'new-member@example.com' });
    expect(addedToWorkspace.status).toBe(201);

    const [removed, addedToTeam] = await Promise.all([
      request(app)
        .delete(`/api/workspaces/${fixture.workspace.id}/members/${newMember.id}`)
        .set('Origin', trustedTestOrigin)
        .set('Cookie', fixture.owner.cookie),
      request(app)
        .post(`/api/workspaces/${fixture.workspace.id}/teams/${fixture.teamId}/members`)
        .set('Origin', trustedTestOrigin)
        .set('Cookie', fixture.owner.cookie)
        .send({ userId: newMember.id }),
    ]);

    const [workspaceMember, teamMember] = await Promise.all([
      prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: fixture.workspace.id, userId: newMember.id } } }),
      prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: fixture.teamId, userId: newMember.id } } }),
    ]);
    expect(removed.status).toBe(204);
    expect([201, 400]).toContain(addedToTeam.status);
    if (addedToTeam.status === 400) expect(addedToTeam.body.error.code).toBe('INVALID_TEAM_MEMBER');
    expect(workspaceMember).toBeNull();
    expect(teamMember).toBeNull();
  });

  it('serializes workspace-role demotion against an admin-only team write', async () => {
    const owner = await registerTestUser(app, 'owner@example.com');
    const admin = await registerTestUser(app, 'admin@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    await request(app)
      .post(`/api/workspaces/${workspace.id}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ email: 'admin@example.com' });
    const promoted = await request(app)
      .patch(`/api/workspaces/${workspace.id}/members/${admin.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ role: 'ADMIN' });
    expect(promoted.status).toBe(200);

    const [demoted, createdTeam] = await Promise.all([
      request(app)
        .patch(`/api/workspaces/${workspace.id}/members/${admin.id}`)
        .set('Origin', trustedTestOrigin)
        .set('Cookie', owner.cookie)
        .send({ role: 'MEMBER' }),
      request(app)
        .post(`/api/workspaces/${workspace.id}/teams`)
        .set('Origin', trustedTestOrigin)
        .set('Cookie', admin.cookie)
        .send({ name: 'Concurrent team' }),
    ]);

    const finalMembership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: admin.id } },
    });
    expect(demoted.status).toBe(200);
    expect([201, 403]).toContain(createdTeam.status);
    if (createdTeam.status === 403) expect(createdTeam.body.error.code).toBe('FORBIDDEN');
    expect(finalMembership?.role).toBe('MEMBER');
  });

  it('serializes team-member removal against task assignment and clears any committed assignment', async () => {
    const fixture = await createAssignedTask();
    const [removed, reassigned] = await Promise.all([
      request(app)
        .delete(`/api/workspaces/${fixture.workspace.id}/teams/${fixture.teamId}/members/${fixture.assignee.id}`)
        .set('Origin', trustedTestOrigin)
        .set('Cookie', fixture.owner.cookie),
      assignAgain({ ...fixture, assigneeId: fixture.assignee.id }),
    ]);

    const [task, member] = await Promise.all([
      prisma.task.findUnique({ where: { id: fixture.taskId } }),
      prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: fixture.teamId, userId: fixture.assignee.id } } }),
    ]);
    expect(removed.status).toBe(204);
    expectAssignmentRaceOutcome(reassigned.status, reassigned.body as { error?: { code?: string } });
    expect(member).toBeNull();
    expect(task?.assigneeId).toBeNull();
  });

  it('serializes workspace-member removal against task assignment and leaves no stale membership or assignee', async () => {
    const fixture = await createAssignedTask();
    const [removed, reassigned] = await Promise.all([
      request(app)
        .delete(`/api/workspaces/${fixture.workspace.id}/members/${fixture.assignee.id}`)
        .set('Origin', trustedTestOrigin)
        .set('Cookie', fixture.owner.cookie),
      assignAgain({ ...fixture, assigneeId: fixture.assignee.id }),
    ]);

    const [task, workspaceMember, teamMember] = await Promise.all([
      prisma.task.findUnique({ where: { id: fixture.taskId } }),
      prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: fixture.workspace.id, userId: fixture.assignee.id } } }),
      prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: fixture.teamId, userId: fixture.assignee.id } } }),
    ]);
    expect(removed.status).toBe(204);
    expectAssignmentRaceOutcome(reassigned.status, reassigned.body as { error?: { code?: string } });
    expect(workspaceMember).toBeNull();
    expect(teamMember).toBeNull();
    expect(task?.assigneeId).toBeNull();
  });
});
