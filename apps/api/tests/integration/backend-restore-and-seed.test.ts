import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { businessUsageDate, quotaScopes, reserveQuota } from '../../src/modules/planner/quota.service.js';
import { createTestDatabase, resetTestDatabase, testDatabaseUrl } from '../helpers/db.js';

const prisma: PrismaClient = createTestDatabase();
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = resolve(apiRoot, '../..');
const tsxCli = resolve(repositoryRoot, 'node_modules/tsx/dist/cli.mjs');
const testPassword = 'phase-seven-isolated-demo-password';

beforeAll(async () => {
  if (!testDatabaseUrl) throw new Error('A dedicated TEST_DATABASE_URL is required for delivery-hardening integration tests.');
  await prisma.$connect();
});

beforeEach(async () => {
  await resetTestDatabase(prisma);
  await prisma.aiQuotaReconciliation.deleteMany();
  await prisma.aiRuntimeControl.update({
    where: { id: 1 },
    data: { quarantined: false, quarantineReason: null },
  });
});

afterAll(async () => prisma.$disconnect());

describe('restore isolation and demo seed scripts', () => {
  it('requires explicit seed opt-in and a password, then seeds isolated demo workspaces idempotently', async () => {
    const optedOut = runApiScript('prisma/seed.ts', [], { SEED_DEMO_DATA: '', SEED_DEMO_PASSWORD: '' });
    expect(optedOut.status).not.toBe(0);
    expect(optedOut.stderr).toContain('Set SEED_DEMO_DATA=yes');
    expect(await prisma.user.count()).toBe(0);

    const missingPassword = runApiScript('prisma/seed.ts', [], { SEED_DEMO_DATA: 'yes', SEED_DEMO_PASSWORD: '' });
    expect(missingPassword.status).not.toBe(0);
    expect(missingPassword.stderr).toContain('SEED_DEMO_PASSWORD');
    expect(await prisma.user.count()).toBe(0);

    const firstRun = runApiScript('prisma/seed.ts', [], { SEED_DEMO_DATA: 'yes', SEED_DEMO_PASSWORD: testPassword });
    expect(firstRun.status, firstRun.stderr).toBe(0);
    const secondRun = runApiScript('prisma/seed.ts', [], { SEED_DEMO_DATA: 'yes', SEED_DEMO_PASSWORD: testPassword });
    expect(secondRun.status, secondRun.stderr).toBe(0);

    const [users, workspaces, teams, tasks, memberships] = await Promise.all([
      prisma.user.findMany({ orderBy: { email: 'asc' } }),
      prisma.workspace.findMany({ orderBy: { name: 'asc' } }),
      prisma.team.findMany(),
      prisma.task.findMany({ orderBy: { title: 'asc' } }),
      prisma.workspaceMember.count(),
    ]);
    const alphaTasks = await prisma.task.findMany({ where: { workspaceId: '20000000-0000-4000-8000-000000000001' } });
    const overdue = alphaTasks.find(({ title }) => title === 'Tích hợp cổng thanh toán VNPay (sandbox)');
    const dueToday = alphaTasks.find(({ title }) => title === 'Xử lý webhook xác nhận thanh toán');
    const upcoming = alphaTasks.find(({ title }) => title === 'API tạo đơn hàng và trừ tồn kho trong một transaction');
    const demoOwner = users.find(({ email }) => email === 'anh@gmail.com');
    const runtimeControl = await prisma.aiRuntimeControl.findUniqueOrThrow({ where: { id: 1 } });

    expect(users.map(({ email }) => email)).toEqual([
      'anh@gmail.com', 'khanh@gmail.com',
    ]);
    expect(workspaces.map(({ name }) => name)).toEqual(['AIM Studio', 'Quán Cà Phê Sáng']);
    expect(teams).toHaveLength(3);
    expect(tasks).toHaveLength(44);
    expect(memberships).toBe(2);
    expect(overdue?.dueDate && dueToday?.dueDate && upcoming?.dueDate).toBeTruthy();
    expect(overdue!.dueDate!.getTime()).toBe(dueToday!.dueDate!.getTime() - 86_400_000);
    expect(upcoming!.dueDate!.getTime()).toBe(dueToday!.dueDate!.getTime() + 86_400_000);
    expect(await prisma.taskChecklist.count()).toBe(30);
    expect(await prisma.taskDependency.count()).toBe(24);
    expect(runtimeControl.quarantined).toBe(false);
    expect(demoOwner?.passwordHash).toBeTruthy();
    expect(demoOwner?.passwordHash).not.toBe(testPassword);
    expect(firstRun.stdout).toContain('Use SEED_DEMO_PASSWORD to sign in.');
  });

  it('quarantines AI during restore, conservatively settles an in-flight call, and audits a closed quota window', async () => {
    const fixture = await createRestoreFixture();
    const initialClock = await prisma.realtimeClock.findUniqueOrThrow({ where: { id: 1 } });
    const refusedRestore = runApiScript('src/jobs/post-restore-backend.ts', [], { CONFIRM_BACKEND_RESTORE: '' });
    expect(refusedRestore.status).not.toBe(0);
    expect(refusedRestore.stderr).toContain('Post-restore backend isolation failed');
    expect((await prisma.aiRuntimeControl.findUniqueOrThrow({ where: { id: 1 } })).quarantined).toBe(false);

    const restored = runApiScript('src/jobs/post-restore-backend.ts', [], { CONFIRM_BACKEND_RESTORE: 'yes' });
    expect(restored.status, restored.stderr).toBe(0);

    const [control, job, usageRows, clock, sessions, events] = await Promise.all([
      prisma.aiRuntimeControl.findUniqueOrThrow({ where: { id: 1 } }),
      prisma.aiJob.findUniqueOrThrow({ where: { id: fixture.jobId } }),
      prisma.aiUsageDaily.findMany({ where: { usageDate: fixture.usageDate } }),
      prisma.realtimeClock.findUniqueOrThrow({ where: { id: 1 } }),
      prisma.session.count(),
      prisma.realtimeEvent.count(),
    ]);
    const rowsForExpectedScopes = usageRows.filter(({ scopeType, scopeId }) =>
      scopeType === 'GLOBAL' || scopeId === fixture.userId || scopeId === fixture.workspaceId);
    expect(control).toMatchObject({ quarantined: true, quarantineReason: 'RESTORE_REQUIRES_RECONCILIATION' });
    expect(job).toMatchObject({
      status: 'CANCELLED', safeErrorCode: 'RESTORE_INTERRUPTED', quotaSettled: true,
      providerAttemptStartedAt: null, providerAttemptUnknown: true,
      providerCallsUsed: 1, inputTokensUsed: fixture.maxInputTokens, outputTokensUsed: fixture.maxOutputTokens,
    });
    expect(rowsForExpectedScopes).toHaveLength(3);
    expect(rowsForExpectedScopes.every((row) => row.operationsReserved === 0 && row.operationsUsed === 1)).toBe(true);
    expect(rowsForExpectedScopes.every((row) => row.callsReserved === 0 && row.callsUsed === 1)).toBe(true);
    expect(rowsForExpectedScopes.every((row) => row.inputTokensReserved === 0n && row.inputTokensUsed === BigInt(fixture.maxInputTokens))).toBe(true);
    expect(rowsForExpectedScopes.every((row) => row.outputTokensReserved === 0n && row.outputTokensUsed === BigInt(fixture.maxOutputTokens))).toBe(true);
    expect(clock.epoch).not.toBe(initialClock.epoch);
    expect(clock.lastSeq).toBe(0n);
    expect(sessions).toBe(0);
    expect(events).toBe(0);
    await expect(prisma.$transaction((tx) => reserveQuota(tx, {
      scopes: quotaScopes(fixture.userId, fixture.workspaceId), usageDate: fixture.usageDate,
      maxInputTokens: fixture.maxInputTokens, maxOutputTokens: fixture.maxOutputTokens,
    }))).rejects.toMatchObject({ statusCode: 503, code: 'AI_RESTORE_QUARANTINE' });

    const refusedReconciliation = runApiScript('src/jobs/reconcile-ai-quota.ts', [
      '--operator', 'test-operator', '--reason', 'test restore review', '--confirm', 'close-current-window',
    ], { CONFIRM_AI_QUOTA_RECONCILIATION: '' });
    expect(refusedReconciliation.status).not.toBe(0);
    expect(refusedReconciliation.stderr).toContain('CONFIRM_AI_QUOTA_RECONCILIATION=yes');
    expect((await prisma.aiRuntimeControl.findUniqueOrThrow({ where: { id: 1 } })).quarantined).toBe(true);
    expect(await prisma.aiQuotaReconciliation.count()).toBe(0);

    const reconciliation = runApiScript('src/jobs/reconcile-ai-quota.ts', [
      '--operator', 'test-operator', '--reason', 'Verified restored usage; close current window.', '--confirm', 'close-current-window',
    ], { CONFIRM_AI_QUOTA_RECONCILIATION: 'yes' });
    expect(reconciliation.status, reconciliation.stderr).toBe(0);

    const [releasedControl, audit, finalUsage] = await Promise.all([
      prisma.aiRuntimeControl.findUniqueOrThrow({ where: { id: 1 } }),
      prisma.aiQuotaReconciliation.findFirstOrThrow(),
      prisma.aiUsageDaily.findMany({ where: { usageDate: fixture.usageDate } }),
    ]);
    expect(releasedControl).toMatchObject({ quarantined: false, quarantineReason: null });
    expect(audit).toMatchObject({
      usageDate: fixture.usageDate, operationsUsed: 100, providerCallsUsed: 400,
      inputTokensUsed: BigInt(fixture.maxInputTokens), outputTokensUsed: BigInt(fixture.maxOutputTokens),
      unknownProviderCalls: 1, enabledAfterReview: true, operator: 'test-operator',
      reason: 'Verified restored usage; close current window.',
    });
    expect(finalUsage.every((row) => row.operationsReserved === 0 && row.callsReserved === 0)).toBe(true);
    expect(finalUsage.every((row) => row.callsUsed === 400 && row.inputTokensReserved === 0n && row.outputTokensReserved === 0n)).toBe(true);
    await expect(prisma.$transaction((tx) => reserveQuota(tx, {
      scopes: quotaScopes(fixture.userId, fixture.workspaceId), usageDate: fixture.usageDate,
      maxInputTokens: fixture.maxInputTokens, maxOutputTokens: fixture.maxOutputTokens,
    }))).rejects.toMatchObject({ statusCode: 429, code: 'AI_QUOTA_EXCEEDED' });
  });
});

async function createRestoreFixture() {
  const user = await prisma.user.create({ data: { email: 'restore-owner@example.test', passwordHash: 'test-only-hash', displayName: 'Restore Owner' } });
  const workspace = await prisma.workspace.create({ data: { name: 'Restore workspace' } });
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' } });
  const team = await prisma.team.create({ data: { workspaceId: workspace.id, name: 'Restore team' } });
  await prisma.teamMember.create({ data: { workspaceId: workspace.id, teamId: team.id, userId: user.id } });
  await prisma.session.create({ data: { userId: user.id, tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 3_600_000) } });
  const plan = await prisma.aiPlan.create({ data: { workspaceId: workspace.id, teamId: team.id, creatorId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
  const usageDate = businessUsageDate();
  const maxInputTokens = 12_000;
  const maxOutputTokens = 3_000;
  const jobId = randomUUID();
  const now = new Date();
  const stageData = [{ key: 'generate_plan', label: 'Generate plan', status: 'active', startedAt: now.toISOString(), completedAt: null, summary: null }];
  await prisma.aiJob.create({
    data: {
      id: jobId, planId: plan.id, workspaceId: workspace.id, teamId: team.id, creatorId: user.id,
      credentialRevision: randomUUID(), retryRootId: jobId, attemptLimit: 4, usageDate,
      maxInputTokens, maxOutputTokens, status: 'RUNNING', requestKey: 'restore-job-request-01',
      requestHash: 'b'.repeat(64), input: { goal: 'test restore isolation' }, stages: stageData,
      currentStage: 'generate_plan', sequence: 5, leaseToken: randomUUID(), leaseExpiresAt: new Date(now.getTime() + 30_000),
      attempt: 1, providerAttempts: 1, providerAttemptStartedAt: now, providerAttemptUnknown: true,
      providerCallsUsed: 1, model: 'fake-model', promptVersion: 'test-v1', expiresAt: plan.expiresAt,
    },
  });
  const scopes = quotaScopes(user.id, workspace.id);
  await prisma.aiUsageDaily.createMany({
    data: scopes.map((scope) => ({
      scopeType: scope.type,
      scopeId: scope.id,
      usageDate,
      operationsReserved: 1,
      callsReserved: 3,
      callsUsed: 1,
      inputTokensReserved: BigInt(4 * maxInputTokens),
      outputTokensReserved: BigInt(4 * maxOutputTokens),
    })),
  });
  const realtimeClock = await prisma.realtimeClock.findUniqueOrThrow({ where: { id: 1 } });
  await prisma.realtimeEvent.create({
    data: {
      id: randomUUID(), epoch: realtimeClock.epoch, seq: 1n, eventType: 'team.tasks_changed', schemaVersion: 1,
      workspaceId: workspace.id, teamId: team.id, resourceId: plan.id, payload: { operation: 'updated' },
    },
  });
  await prisma.realtimeClock.update({ where: { id: 1 }, data: { lastSeq: 1n } });
  return { userId: user.id, workspaceId: workspace.id, jobId, usageDate, maxInputTokens, maxOutputTokens };
}

function runApiScript(script: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [tsxCli, script, ...args], {
    cwd: apiRoot,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1_000_000,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testDatabaseUrl,
      SEED_DEMO_DATA: '',
      SEED_DEMO_PASSWORD: '',
      CONFIRM_BACKEND_RESTORE: '',
      CONFIRM_AI_QUOTA_RECONCILIATION: '',
      ...extraEnv,
    },
  });
}
