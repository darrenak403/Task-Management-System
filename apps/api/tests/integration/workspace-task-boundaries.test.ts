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

async function addWorkspaceMember(workspaceId: string, ownerCookie: string, email: string) {
  return request(app)
    .post(`/api/workspaces/${workspaceId}/members`)
    .set('Origin', trustedTestOrigin)
    .set('Cookie', ownerCookie)
    .send({ email });
}

async function createTeam(workspaceId: string, cookie: string, name: string) {
  return request(app)
    .post(`/api/workspaces/${workspaceId}/teams`)
    .set('Origin', trustedTestOrigin)
    .set('Cookie', cookie)
    .send({ name });
}

async function createTask(workspaceId: string, teamId: string, cookie: string, data: Record<string, unknown>) {
  return request(app)
    .post(`/api/workspaces/${workspaceId}/teams/${teamId}/tasks`)
    .set('Origin', trustedTestOrigin)
    .set('Cookie', cookie)
    .send(data);
}

describe('workspace and task boundary cases', () => {
  it('allows workspace admins to rename workspace/team and manage members without granting admin roles', async () => {
    const owner = await registerTestUser(app, 'owner@example.com');
    const admin = await registerTestUser(app, 'admin@example.com');
    const promotedLater = await registerTestUser(app, 'promoted-later@example.com');
    const removable = await registerTestUser(app, 'removable@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);

    expect((await addWorkspaceMember(workspace.id, owner.cookie, 'admin@example.com')).status).toBe(201);
    expect((await addWorkspaceMember(workspace.id, owner.cookie, 'promoted-later@example.com')).status).toBe(201);
    expect((await request(app)
      .patch(`/api/workspaces/${workspace.id}/members/${admin.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ role: 'ADMIN' })).status).toBe(200);
    expect((await addWorkspaceMember(workspace.id, admin.cookie, 'removable@example.com')).status).toBe(201);

    const team = await createTeam(workspace.id, owner.cookie, 'Backend');
    const teamId = team.body.data.id as string;
    const renamedWorkspace = await request(app)
      .patch(`/api/workspaces/${workspace.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', admin.cookie)
      .send({ name: 'Engineering' });
    const renamedTeam = await request(app)
      .patch(`/api/workspaces/${workspace.id}/teams/${teamId}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', admin.cookie)
      .send({ name: 'Platform' });
    const memberWorkspaceRename = await request(app)
      .patch(`/api/workspaces/${workspace.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', promotedLater.cookie)
      .send({ name: 'Forbidden workspace rename' });
    const memberTeamRename = await request(app)
      .patch(`/api/workspaces/${workspace.id}/teams/${teamId}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', promotedLater.cookie)
      .send({ name: 'Forbidden team rename' });
    const adminPromotesMember = await request(app)
      .patch(`/api/workspaces/${workspace.id}/members/${promotedLater.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', admin.cookie)
      .send({ role: 'ADMIN' });

    expect(renamedWorkspace.status).toBe(200);
    expect(renamedWorkspace.body.data.name).toBe('Engineering');
    expect(renamedTeam.status).toBe(200);
    expect(renamedTeam.body.data.name).toBe('Platform');
    expect(memberWorkspaceRename.status).toBe(403);
    expect(memberTeamRename.status).toBe(403);
    expect(adminPromotesMember.status).toBe(403);

    const promoteAnotherAdmin = await request(app)
      .patch(`/api/workspaces/${workspace.id}/members/${promotedLater.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ role: 'ADMIN' });
    const adminRemovesAdmin = await request(app)
      .delete(`/api/workspaces/${workspace.id}/members/${promotedLater.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', admin.cookie)
      .set('Content-Type', 'application/json')
      .send({});
    const adminRemovesMember = await request(app)
      .delete(`/api/workspaces/${workspace.id}/members/${removable.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', admin.cookie)
      .set('Content-Type', 'application/json')
      .send({});

    expect(promoteAnotherAdmin.status).toBe(200);
    expect(adminRemovesAdmin.status).toBe(403);
    expect(adminRemovesMember.status).toBe(204);
  });

  it('scopes task list and literal search to teams the member has joined and returns only public task fields', async () => {
    const owner = await registerTestUser(app, 'owner@example.com');
    const member = await registerTestUser(app, 'member@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    expect((await addWorkspaceMember(workspace.id, owner.cookie, 'member@example.com')).status).toBe(201);

    const memberTeam = await createTeam(workspace.id, owner.cookie, 'Member team');
    const hiddenTeam = await createTeam(workspace.id, owner.cookie, 'Private team');
    const memberTeamId = memberTeam.body.data.id as string;
    const hiddenTeamId = hiddenTeam.body.data.id as string;
    expect((await request(app)
      .post(`/api/workspaces/${workspace.id}/teams/${memberTeamId}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ userId: member.id })).status).toBe(201);
    expect((await createTask(workspace.id, memberTeamId, owner.cookie, { title: 'Visible task' })).status).toBe(201);
    expect((await createTask(workspace.id, hiddenTeamId, owner.cookie, { title: 'Private marker task' })).status).toBe(201);

    const memberList = await request(app).get(`/api/workspaces/${workspace.id}/tasks`).set('Cookie', member.cookie);
    const hiddenSearch = await request(app).get(`/api/workspaces/${workspace.id}/tasks?q=Private%20marker`).set('Cookie', member.cookie);
    const ownerList = await request(app).get(`/api/workspaces/${workspace.id}/tasks`).set('Cookie', owner.cookie);

    expect(memberList.status).toBe(200);
    expect(memberList.body.meta.total).toBe(1);
    expect(memberList.body.data.map((task: { title: string }) => task.title)).toEqual(['Visible task']);
    expect(Object.keys(memberList.body.data[0]).sort()).toEqual([
      'assigneeId', 'checklist', 'completionCriteria', 'createdAt', 'createdBy', 'dependencies', 'description', 'dueDate',
      'estimateMaxMinutes', 'estimateMinMinutes', 'id', 'priority', 'priorityReason', 'schedule', 'status', 'teamId', 'title',
      'updatedAt', 'workspaceId',
    ]);
    expect(hiddenSearch.status).toBe(200);
    expect(hiddenSearch.body.meta.total).toBe(0);
    expect(hiddenSearch.body.data).toEqual([]);
    expect(ownerList.body.meta.total).toBe(2);
  });

  it('rejects task access when workspace and team route scopes do not match the stored task', async () => {
    const ownerA = await registerTestUser(app, 'owner-a@example.com');
    const ownerB = await registerTestUser(app, 'owner-b@example.com');
    const workspaceA = await createTestWorkspace(app, ownerA.cookie, 'Workspace A');
    const workspaceB = await createTestWorkspace(app, ownerB.cookie, 'Workspace B');
    const teamA = await createTeam(workspaceA.id, ownerA.cookie, 'Team A');
    const teamB = await createTeam(workspaceB.id, ownerB.cookie, 'Team B');
    const teamAId = teamA.body.data.id as string;
    const teamBId = teamB.body.data.id as string;
    const taskA = await createTask(workspaceA.id, teamAId, ownerA.cookie, { title: 'Task A' });
    const taskB = await createTask(workspaceB.id, teamBId, ownerB.cookie, { title: 'Task B' });

    const crossWorkspaceRead = await request(app)
      .get(`/api/workspaces/${workspaceA.id}/teams/${teamBId}/tasks/${taskB.body.data.id as string}`)
      .set('Cookie', ownerA.cookie);
    const crossTeamRead = await request(app)
      .get(`/api/workspaces/${workspaceB.id}/teams/${teamAId}/tasks/${taskA.body.data.id as string}`)
      .set('Cookie', ownerB.cookie);
    const crossWorkspaceCreate = await createTask(workspaceA.id, teamBId, ownerA.cookie, { title: 'Wrong scope' });

    expect(crossWorkspaceRead.status).toBe(404);
    expect(crossTeamRead.status).toBe(404);
    expect(crossWorkspaceCreate.status).toBe(404);
  });

  it('allows explicit null PATCH values to clear a task due date and assignee', async () => {
    const owner = await registerTestUser(app, 'owner@example.com');
    const member = await registerTestUser(app, 'member@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    expect((await addWorkspaceMember(workspace.id, owner.cookie, 'member@example.com')).status).toBe(201);
    const team = await createTeam(workspace.id, owner.cookie, 'Backend');
    const teamId = team.body.data.id as string;
    expect((await request(app)
      .post(`/api/workspaces/${workspace.id}/teams/${teamId}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ userId: member.id })).status).toBe(201);
    const task = await createTask(workspace.id, teamId, owner.cookie, {
      title: 'Clear optional values',
      assigneeId: member.id,
      dueDate: '2026-10-12',
    });
    const cleared = await request(app)
      .patch(`/api/workspaces/${workspace.id}/teams/${teamId}/tasks/${task.body.data.id as string}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ assigneeId: null, dueDate: null });

    expect(task.status).toBe(201);
    expect(task.body.data.assigneeId).toBe(member.id);
    expect(task.body.data.dueDate).toBe('2026-10-12');
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.assigneeId).toBeNull();
    expect(cleared.body.data.dueDate).toBeNull();
  });
});
