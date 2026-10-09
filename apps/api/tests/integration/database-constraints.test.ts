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

describe('workspace and team database constraints', () => {
  it('rejects cross-workspace team/task scopes and assignees outside the task team', async () => {
    const ownerA = await registerTestUser(app, 'owner-a@example.com');
    const ownerB = await registerTestUser(app, 'owner-b@example.com');
    const workspaceA = await createTestWorkspace(app, ownerA.cookie, 'Workspace A');
    const workspaceB = await createTestWorkspace(app, ownerB.cookie, 'Workspace B');
    const teamAResponse = await request(app)
      .post(`/api/workspaces/${workspaceA.id}/teams`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', ownerA.cookie)
      .send({ name: 'Team A' });
    const teamBResponse = await request(app)
      .post(`/api/workspaces/${workspaceB.id}/teams`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', ownerB.cookie)
      .send({ name: 'Team B' });
    const teamAId = teamAResponse.body.data.id as string;
    const teamBId = teamBResponse.body.data.id as string;
    await request(app)
      .post(`/api/workspaces/${workspaceB.id}/teams/${teamBId}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', ownerB.cookie)
      .send({ userId: ownerB.id });

    await expect(prisma.task.create({
      data: {
        workspaceId: workspaceA.id,
        teamId: teamAId,
        createdBy: ownerA.id,
        assigneeId: ownerB.id,
        title: 'Cross-team assignee',
      },
    })).rejects.toMatchObject({ code: 'P2003' });

    await expect(prisma.task.create({
      data: {
        workspaceId: workspaceA.id,
        teamId: teamBId,
        createdBy: ownerA.id,
        title: 'Cross-workspace team',
      },
    })).rejects.toMatchObject({ code: 'P2003' });
  });
});
