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

describe('task authorization and writes', () => {
  it('scopes reads by workspace and team, allows teammate edits, and restricts member deletion', async () => {
    const owner = await registerTestUser(app, 'owner@example.com');
    const memberA = await registerTestUser(app, 'member-a@example.com');
    const memberB = await registerTestUser(app, 'member-b@example.com');
    const outsider = await registerTestUser(app, 'outsider@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);

    for (const email of ['member-a@example.com', 'member-b@example.com']) {
      await request(app).post(`/api/workspaces/${workspace.id}/members`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ email });
    }
    const teamAResponse = await request(app).post(`/api/workspaces/${workspace.id}/teams`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ name: 'Backend' });
    const teamBResponse = await request(app).post(`/api/workspaces/${workspace.id}/teams`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ name: 'Frontend' });
    const teamA = teamAResponse.body.data.id as string;
    const teamB = teamBResponse.body.data.id as string;
    for (const userId of [memberA.id, memberB.id]) {
      await request(app).post(`/api/workspaces/${workspace.id}/teams/${teamA}/members`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ userId });
    }
    await request(app).post(`/api/workspaces/${workspace.id}/teams/${teamB}/members`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ userId: memberB.id });

    const memberTask = await request(app)
      .post(`/api/workspaces/${workspace.id}/teams/${teamA}/tasks`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', memberA.cookie)
      .send({ title: 'Member created task', assigneeId: memberB.id });
    const teammateEdit = await request(app)
      .patch(`/api/workspaces/${workspace.id}/teams/${teamA}/tasks/${memberTask.body.data.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', memberB.cookie)
      .send({ status: 'IN_PROGRESS', title: 'Updated by teammate' });
    const teammateDelete = await request(app)
      .delete(`/api/workspaces/${workspace.id}/teams/${teamA}/tasks/${memberTask.body.data.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', memberB.cookie);
    const ownerTask = await request(app)
      .post(`/api/workspaces/${workspace.id}/teams/${teamB}/tasks`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ title: 'Private to other team' });
    const crossTeamRead = await request(app)
      .get(`/api/workspaces/${workspace.id}/teams/${teamB}/tasks/${ownerTask.body.data.id}`)
      .set('Cookie', memberA.cookie);
    const outsiderList = await request(app).get(`/api/workspaces/${workspace.id}/tasks`).set('Cookie', outsider.cookie);
    const deleteCreatorTask = await request(app)
      .delete(`/api/workspaces/${workspace.id}/teams/${teamA}/tasks/${memberTask.body.data.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', memberA.cookie)
      .set('Content-Type', 'application/json')
      .send({});

    expect(memberTask.status).toBe(201);
    expect(memberTask.body.data.status).toBe('TODO');
    expect(memberTask.body.data.priority).toBe('MEDIUM');
    expect(memberTask.body.data.description).toBe('');
    expect(teammateEdit.status).toBe(200);
    expect(teammateEdit.body.data.status).toBe('IN_PROGRESS');
    expect(teammateDelete.status).toBe(403);
    expect(crossTeamRead.status).toBe(404);
    expect(outsiderList.status).toBe(404);
    expect(deleteCreatorTask.status).toBe(204);
  });

  it('rejects invalid scopes, assignees, empty patches and injected fields', async () => {
    const owner = await registerTestUser(app, 'owner@example.com');
    const member = await registerTestUser(app, 'member@example.com');
    const outsider = await registerTestUser(app, 'outsider@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    await request(app).post(`/api/workspaces/${workspace.id}/members`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ email: 'member@example.com' });
    const teamResponse = await request(app).post(`/api/workspaces/${workspace.id}/teams`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ name: 'Backend' });
    const teamId = teamResponse.body.data.id as string;
    await request(app).post(`/api/workspaces/${workspace.id}/teams/${teamId}/members`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ userId: member.id });

    const invalidAssignee = await request(app)
      .post(`/api/workspaces/${workspace.id}/teams/${teamId}/tasks`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', member.cookie)
      .send({ title: 'Invalid assignment', assigneeId: outsider.id });
    const created = await request(app)
      .post(`/api/workspaces/${workspace.id}/teams/${teamId}/tasks`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', member.cookie)
      .send({ title: 'Scoped task' });
    const emptyPatch = await request(app)
      .patch(`/api/workspaces/${workspace.id}/teams/${teamId}/tasks/${created.body.data.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', member.cookie)
      .send({});
    const injectedField = await request(app)
      .patch(`/api/workspaces/${workspace.id}/teams/${teamId}/tasks/${created.body.data.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', member.cookie)
      .send({ createdBy: owner.id });
    const invalidDate = await request(app)
      .post(`/api/workspaces/${workspace.id}/teams/${teamId}/tasks`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', member.cookie)
      .send({ title: 'Bad date', dueDate: '2026-02-30' });
    const zeroYearDate = await request(app)
      .post(`/api/workspaces/${workspace.id}/teams/${teamId}/tasks`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', member.cookie)
      .send({ title: 'Year zero date', dueDate: '0000-01-01' });
    const invalidTeamFilter = await request(app)
      .get(`/api/workspaces/${workspace.id}/tasks?teamId=${outsider.id}`)
      .set('Cookie', member.cookie);

    expect(invalidAssignee.status).toBe(400);
    expect(invalidAssignee.body.error.code).toBe('INVALID_ASSIGNEE');
    expect(created.status).toBe(201);
    expect(emptyPatch.status).toBe(400);
    expect(injectedField.status).toBe(400);
    expect(invalidDate.status).toBe(400);
    expect(zeroYearDate.status).toBe(400);
    expect(invalidTeamFilter.status).toBe(404);
  });
});
