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

async function makeTask(input: {
  workspaceId: string;
  teamId: string;
  cookie: string;
  title: string;
  status?: 'TODO' | 'IN_PROGRESS' | 'DONE';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  dueDate?: string;
  assigneeId?: string;
}) {
  return request(app)
    .post(`/api/workspaces/${input.workspaceId}/teams/${input.teamId}/tasks`)
    .set('Origin', trustedTestOrigin)
    .set('Cookie', input.cookie)
    .send({
      title: input.title,
      status: input.status,
      priority: input.priority,
      dueDate: input.dueDate,
      assigneeId: input.assigneeId,
    });
}

function todayInHoChiMinh(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function offsetDay(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('task query and dashboard scope', () => {
  it('treats percent and underscore as literal search characters and applies filters with AND', async () => {
    const owner = await registerTestUser(app, 'owner@example.com');
    const member = await registerTestUser(app, 'member@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    await request(app).post(`/api/workspaces/${workspace.id}/members`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ email: 'member@example.com' });
    const team = await request(app).post(`/api/workspaces/${workspace.id}/teams`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ name: 'Backend' });
    const teamId = team.body.data.id as string;
    await request(app).post(`/api/workspaces/${workspace.id}/teams/${teamId}/members`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ userId: member.id });

    await makeTask({ workspaceId: workspace.id, teamId, cookie: owner.cookie, title: 'Release 100%_ready first', status: 'TODO', priority: 'HIGH', assigneeId: member.id });
    await makeTask({ workspaceId: workspace.id, teamId, cookie: owner.cookie, title: 'Release 100%_ready second', status: 'TODO', priority: 'HIGH', assigneeId: member.id });
    await makeTask({ workspaceId: workspace.id, teamId, cookie: owner.cookie, title: 'Release 100Xready decoy', status: 'TODO', priority: 'HIGH', assigneeId: member.id });
    await makeTask({ workspaceId: workspace.id, teamId, cookie: owner.cookie, title: 'Find under_score literal', status: 'IN_PROGRESS', priority: 'LOW' });
    await makeTask({ workspaceId: workspace.id, teamId, cookie: owner.cookie, title: 'Find underXscore decoy', status: 'TODO', priority: 'LOW' });

    const query = new URLSearchParams({
      q: '100%_ready',
      status: 'TODO',
      priority: 'HIGH',
      teamId,
      assigneeId: member.id,
      page: '1',
      pageSize: '1',
    });
    const firstPage = await request(app).get(`/api/workspaces/${workspace.id}/tasks?${query}`).set('Cookie', member.cookie);
    query.set('page', '2');
    const secondPage = await request(app).get(`/api/workspaces/${workspace.id}/tasks?${query}`).set('Cookie', member.cookie);
    const literalPercent = await request(app).get(`/api/workspaces/${workspace.id}/tasks?q=${encodeURIComponent('100%_ready')}`).set('Cookie', member.cookie);
    const literalUnderscore = await request(app).get(`/api/workspaces/${workspace.id}/tasks?q=${encodeURIComponent('under_score')}`).set('Cookie', member.cookie);
    const invalidPage = await request(app).get(`/api/workspaces/${workspace.id}/tasks?page=0`).set('Cookie', member.cookie);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.meta).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(secondPage.body.meta.total).toBe(2);
    expect(secondPage.body.data[0].id).not.toBe(firstPage.body.data[0].id);
    expect(literalPercent.body.data).toHaveLength(2);
    expect(literalPercent.body.data.every((task: { title: string }) => task.title.includes('%_'))).toBe(true);
    expect(literalUnderscore.body.data).toHaveLength(1);
    expect(literalUnderscore.body.data[0].title).toBe('Find under_score literal');
    expect(invalidPage.status).toBe(400);
  });

  it('keeps dashboard counts in one role-scoped snapshot and includes only today through day six', async () => {
    const owner = await registerTestUser(app, 'owner@example.com');
    const member = await registerTestUser(app, 'member@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    await request(app).post(`/api/workspaces/${workspace.id}/members`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ email: 'member@example.com' });
    const teamAResponse = await request(app).post(`/api/workspaces/${workspace.id}/teams`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ name: 'Backend' });
    const teamBResponse = await request(app).post(`/api/workspaces/${workspace.id}/teams`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ name: 'Frontend' });
    const teamA = teamAResponse.body.data.id as string;
    const teamB = teamBResponse.body.data.id as string;
    await request(app).post(`/api/workspaces/${workspace.id}/teams/${teamA}/members`).set('Origin', trustedTestOrigin).set('Cookie', owner.cookie).send({ userId: member.id });
    const today = todayInHoChiMinh();
    const cases = [
      { title: 'Due today', status: 'TODO' as const, dueDate: today },
      { title: 'Due day six', status: 'IN_PROGRESS' as const, dueDate: offsetDay(today, 6) },
      { title: 'Overdue', status: 'TODO' as const, dueDate: offsetDay(today, -1) },
      { title: 'Outside seven day window', status: 'TODO' as const, dueDate: offsetDay(today, 7) },
      { title: 'Done today', status: 'DONE' as const, dueDate: today },
    ];
    for (const item of cases) await makeTask({ workspaceId: workspace.id, teamId: teamA, cookie: owner.cookie, ...item });
    await makeTask({ workspaceId: workspace.id, teamId: teamB, cookie: owner.cookie, title: 'Other team task', dueDate: today });

    const memberDashboard = await request(app).get(`/api/workspaces/${workspace.id}/dashboard`).set('Cookie', member.cookie);
    const ownerDashboard = await request(app).get(`/api/workspaces/${workspace.id}/dashboard`).set('Cookie', owner.cookie);
    const unauthorizedTeamDashboard = await request(app).get(`/api/workspaces/${workspace.id}/dashboard?teamId=${teamB}`).set('Cookie', member.cookie);

    expect(memberDashboard.status).toBe(200);
    expect(memberDashboard.body.data.counts).toEqual({ total: 5, todo: 3, inProgress: 1, done: 1 });
    expect(memberDashboard.body.data.upcomingTotal).toBe(2);
    expect(memberDashboard.body.data.upcoming.map((task: { title: string }) => task.title)).toEqual(['Due today', 'Due day six']);
    expect(memberDashboard.body.data.window).toEqual({ from: today, to: offsetDay(today, 6), timeZone: 'Asia/Ho_Chi_Minh' });
    expect(ownerDashboard.body.data.counts.total).toBe(6);
    expect(ownerDashboard.body.data.upcomingTotal).toBe(3);
    expect(unauthorizedTeamDashboard.status).toBe(404);
  });
});
