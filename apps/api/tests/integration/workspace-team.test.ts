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

describe('workspace and team APIs', () => {
  it('creates workspace with an atomic owner membership and applies workspace/team role boundaries', async () => {
    const owner = await registerTestUser(app, 'owner@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const admin = await registerTestUser(app, 'admin@example.com');
    const member = await registerTestUser(app, 'member@example.com');
    const outsider = await registerTestUser(app, 'outsider@example.com');

    const ownerRoster = await request(app).get(`/api/workspaces/${workspace.id}/members`).set('Cookie', owner.cookie);
    const addAdmin = await request(app)
      .post(`/api/workspaces/${workspace.id}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ email: 'admin@example.com' });
    const promoteAdmin = await request(app)
      .patch(`/api/workspaces/${workspace.id}/members/${admin.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ role: 'ADMIN' });
    const addMember = await request(app)
      .post(`/api/workspaces/${workspace.id}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ email: 'member@example.com' });
    const addTeam = await request(app)
      .post(`/api/workspaces/${workspace.id}/teams`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', admin.cookie)
      .send({ name: 'Backend' });
    const addMemberToTeam = await request(app)
      .post(`/api/workspaces/${workspace.id}/teams/${addTeam.body.data.id}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', admin.cookie)
      .send({ userId: member.id });
    const addOutsiderToTeam = await request(app)
      .post(`/api/workspaces/${workspace.id}/teams/${addTeam.body.data.id}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', admin.cookie)
      .send({ userId: outsider.id });
    const memberTeams = await request(app).get(`/api/workspaces/${workspace.id}/teams`).set('Cookie', member.cookie);
    const memberRoster = await request(app)
      .get(`/api/workspaces/${workspace.id}/teams/${addTeam.body.data.id}/members`)
      .set('Cookie', member.cookie);
    const memberWorkspaceRoster = await request(app)
      .get(`/api/workspaces/${workspace.id}/members`)
      .set('Cookie', member.cookie);
    const memberCreateTeam = await request(app)
      .post(`/api/workspaces/${workspace.id}/teams`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', member.cookie)
      .send({ name: 'Forbidden' });

    expect(workspace.role).toBe('OWNER');
    expect(ownerRoster.body.data).toHaveLength(1);
    expect(addAdmin.status).toBe(201);
    expect(promoteAdmin.body.data.role).toBe('ADMIN');
    expect(addMember.body.data.role).toBe('MEMBER');
    expect(addTeam.status).toBe(201);
    expect(addMemberToTeam.status).toBe(201);
    expect(addOutsiderToTeam.status).toBe(400);
    expect(addOutsiderToTeam.body.error.code).toBe('INVALID_TEAM_MEMBER');
    expect(memberTeams.body.data).toHaveLength(1);
    expect(memberTeams.body.data[0].id).toBe(addTeam.body.data.id);
    expect(memberRoster.body.data.map((item: { id: string }) => item.id)).toContain(member.id);
    expect(memberWorkspaceRoster.status).toBe(403);
    expect(memberCreateTeam.status).toBe(403);
  });

  it('lists accounts outside the workspace as member candidates for owners and admins only', async () => {
    const owner = await registerTestUser(app, 'owner@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const member = await registerTestUser(app, 'member@example.com');
    await registerTestUser(app, 'linh@example.com');
    await registerTestUser(app, 'quang@example.com');
    await request(app).post(`/api/workspaces/${workspace.id}/members`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ email: 'member@example.com' });

    const all = await request(app).get(`/api/workspaces/${workspace.id}/member-candidates`).set('Cookie', owner.cookie);
    const searched = await request(app).get(`/api/workspaces/${workspace.id}/member-candidates`).query({ search: 'QUA' }).set('Cookie', owner.cookie);
    const asMember = await request(app).get(`/api/workspaces/${workspace.id}/member-candidates`).set('Cookie', member.cookie);
    const anonymous = await request(app).get(`/api/workspaces/${workspace.id}/member-candidates`);

    expect(all.status).toBe(200);
    expect(all.body.data.map(({ email }: { email: string }) => email)).toEqual(['linh@example.com', 'quang@example.com']);
    expect(Object.keys(all.body.data[0]).sort()).toEqual(['displayName', 'email', 'id']);
    expect(searched.body.data.map(({ email }: { email: string }) => email)).toEqual(['quang@example.com']);
    expect(asMember.status).toBe(403);
    expect(anonymous.status).toBe(401);
  });

  it('atomically clears assignments and revokes team/workspace membership without deleting task history', async () => {
    const owner = await registerTestUser(app, 'owner@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const member = await registerTestUser(app, 'member@example.com');
    await request(app)
      .post(`/api/workspaces/${workspace.id}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ email: 'member@example.com' });
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
      .send({ userId: member.id });
    const taskResponse = await request(app)
      .post(`/api/workspaces/${workspace.id}/teams/${teamId}/tasks`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ title: 'Keep creator history', assigneeId: member.id });
    const taskId = taskResponse.body.data.id as string;

    const removed = await request(app)
      .delete(`/api/workspaces/${workspace.id}/members/${member.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie);
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    const membershipCount = await prisma.workspaceMember.count({ where: { workspaceId: workspace.id, userId: member.id } });
    const teamMembershipCount = await prisma.teamMember.count({ where: { teamId, userId: member.id } });
    const memberAccess = await request(app).get(`/api/workspaces/${workspace.id}/teams/${teamId}`).set('Cookie', member.cookie);

    expect(taskResponse.status).toBe(201);
    expect(removed.status).toBe(204);
    expect(task?.createdBy).toBe(owner.id);
    expect(task?.assigneeId).toBeNull();
    expect(membershipCount).toBe(0);
    expect(teamMembershipCount).toBe(0);
    expect(memberAccess.status).toBe(404);
  });

  it('keeps the single owner immutable and rejects attempts to remove or demote the owner', async () => {
    const owner = await registerTestUser(app, 'owner@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const demote = await request(app)
      .patch(`/api/workspaces/${workspace.id}/members/${owner.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ role: 'MEMBER' });
    const remove = await request(app)
      .delete(`/api/workspaces/${workspace.id}/members/${owner.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .set('Content-Type', 'application/json')
      .send({});
    const ownerRow = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: owner.id } } });

    expect(demote.status).toBe(403);
    expect(remove.status).toBe(403);
    expect(ownerRow?.role).toBe('OWNER');
  });
});
