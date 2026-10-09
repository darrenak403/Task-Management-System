import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { AiJobRepository, LeaseLostError } from '../../src/modules/planner/job.repository.js';
import { AiProviderError } from '../../src/modules/planner/provider.types.js';
import { createPlanSchema } from '../../src/modules/planner/planner.schemas.js';
import { encryptCredential } from '../../src/shared/security/credential-crypto.js';
import { createPlannerTestApp, createPlannerTestEnvironment, plannerTestKeyring } from '../helpers/planner-app.js';
import { createTestDatabase, resetTestDatabase } from '../helpers/db.js';
import { createTestWorkspace, registerTestUser, trustedTestOrigin } from '../helpers/core-app.js';
import { FakeGeminiProvider, successfulUnderstanding } from '../fakes/fake-gemini.js';

const prisma: PrismaClient = createTestDatabase();
const logger = pino({ level: 'silent' });
const environment = createPlannerTestEnvironment();
const consent = {
  providerDisclosureAccepted: true,
  billingAuthorityConfirmed: true,
  selectedContextReviewed: true,
};

type PlannerFixture = ReturnType<typeof createPlannerTestApp>;
type TestUser = { id: string; cookie: string; email: string };
type TestScope = { workspaceId: string; teamId: string };

let provider: FakeGeminiProvider;
let fixture: PlannerFixture;

beforeAll(async () => prisma.$connect());

beforeEach(async () => {
  await resetTestDatabase(prisma);
  provider = new FakeGeminiProvider();
  fixture = createPlannerTestApp({ prisma, logger, environment, provider });
});

afterEach(async () => {
  await fixture.runner.stop();
});

afterAll(async () => {
  await prisma.$disconnect();
  await logger.flush();
});

function goalInput(requestKey: string, goal = 'Build a small task management API for a two person team.') {
  return {
    requestKey,
    goal,
    constraints: 'Keep the first release small and reviewable.',
    detailLevel: 'BALANCED',
    strategy: 'BALANCED',
    consent,
  };
}

async function createUser(email: string): Promise<TestUser> {
  return { ...(await registerTestUser(fixture.app, email)), email };
}

async function createScope(user: TestUser): Promise<TestScope> {
  const workspace = await createTestWorkspace(fixture.app, user.cookie, 'Planner integration workspace');
  const teamResponse = await request(fixture.app)
    .post(`/api/workspaces/${workspace.id}/teams`)
    .set('Origin', trustedTestOrigin)
    .set('Cookie', user.cookie)
    .send({ name: 'Platform team' });
  expect(teamResponse.status, JSON.stringify(teamResponse.body)).toBe(201);
  return { workspaceId: workspace.id, teamId: teamResponse.body.data.id as string };
}

async function storeCredential(userId: string, plaintext: string): Promise<string> {
  const encrypted = encryptCredential({
    plaintext,
    userId,
    provider: 'GEMINI',
    keyVersion: plannerTestKeyring.activeVersion,
    key: plannerTestKeyring.key,
  });
  await fixture.credentialRepository.upsert(userId, encrypted, 'gemini-test-model', new Date('2026-10-09T00:00:00.000Z'));
  return encrypted.credentialRevision;
}

function plannerPath(scope: TestScope, endpoint: string): string {
  return `/api/workspaces/${scope.workspaceId}/teams/${scope.teamId}/${endpoint}`;
}

async function postJob(user: TestUser, scope: TestScope, input = goalInput('request-0001')) {
  return request(fixture.app)
    .post(plannerPath(scope, 'ai-plans'))
    .set('Origin', trustedTestOrigin)
    .set('Cookie', user.cookie)
    .send(input);
}

async function createJob(user: TestUser, scope: TestScope, input = goalInput('request-0001')) {
  const response = await postJob(user, scope, input);
  expect(response.status, JSON.stringify(response.body)).toBe(202);
  return response;
}

async function waitForJobStatus(jobId: string, expected: string, timeoutMs = 5_000) {
  const endAt = Date.now() + timeoutMs;
  let latest: Awaited<ReturnType<typeof prisma.aiJob.findUnique>> = null;
  while (Date.now() < endAt) {
    latest = await prisma.aiJob.findUnique({ where: { id: jobId } });
    if (latest?.status === expected) return latest;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for job ${jobId} to become ${expected}; latest=${latest?.status ?? 'missing'}.`);
}

describe('durable AI planner jobs', () => {
  it('reuses a concurrent idempotent request and rejects the same key with changed content', async () => {
    const user = await createUser('idempotency@example.com');
    const scope = await createScope(user);
    await storeCredential(user.id, 'fake-gemini-key-CreatorKeyForIdempotency-0123456789');
    const input = goalInput('request-idem-0001');

    const [first, concurrent] = await Promise.all([createJob(user, scope, input), createJob(user, scope, input)]);
    const changed = await postJob(user, scope, goalInput(input.requestKey, 'Build a different release plan for the same team.'));
    const usage = await prisma.aiUsageDaily.findFirstOrThrow({ where: { scopeType: 'USER', scopeId: user.id } });

    expect(first.status).toBe(202);
    expect(concurrent.status).toBe(202);
    expect(first.body.data.jobId).toBe(concurrent.body.data.jobId);
    expect(first.body.data.planId).toBe(concurrent.body.data.planId);
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await prisma.aiJob.count()).toBe(1);
    expect(await prisma.aiPlan.count()).toBe(1);
    expect(usage.operationsReserved).toBe(1);
    expect(usage.operationsUsed).toBe(0);
  });

  it('runs the five real stages, persists a private draft, uses only the creator BYOK key, and creates no tasks', async () => {
    const owner = await createUser('plan-owner@example.com');
    const admin = await createUser('workspace-admin@example.com');
    const scope = await createScope(owner);
    const added = await request(fixture.app)
      .post(`/api/workspaces/${scope.workspaceId}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ email: admin.email });
    expect(added.status).toBe(201);
    const roleUpdated = await request(fixture.app)
      .patch(`/api/workspaces/${scope.workspaceId}/members/${admin.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ role: 'ADMIN' });
    expect(roleUpdated.status).toBe(200);

    const sourceTask = await request(fixture.app)
      .post(plannerPath(scope, 'tasks'))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ title: 'Selected launch checklist', description: 'Keep this context in the chosen team only.' });
    expect(sourceTask.status).toBe(201);
    const ownerKey = 'fake-gemini-key-OwnerSpecificPlannerCredential-0123456789';
    const adminKey = 'fake-gemini-key-AdminOtherPlannerCredential-9876543210';
    const ownerRevision = await storeCredential(owner.id, ownerKey);
    await storeCredential(admin.id, adminKey);
    const taskCountBefore = await prisma.task.count();
    const created = await createJob(owner, scope, {
      ...goalInput('request-private-0001'),
      includeExistingTasks: true,
      existingTaskIds: [sourceTask.body.data.id as string],
    });
    expect(created.status).toBe(202);
    const { jobId, planId } = created.body.data as { jobId: string; planId: string };

    await fixture.runner.start();
    await waitForJobStatus(jobId, 'SUCCEEDED');
    await fixture.runner.stop();

    const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
    const plan = await prisma.aiPlan.findUniqueOrThrow({ where: { id: planId } });
    const version = await prisma.aiPlanVersion.findFirstOrThrow({ where: { planId } });
    const providerCalls = provider.calls;
    const events = await prisma.realtimeEvent.findMany({ where: { eventType: 'planner.job_changed', resourceId: jobId } });
    const ownerCredential = await prisma.userGeminiCredential.findUniqueOrThrow({ where: { userId: owner.id } });
    const adminReadPlan = await request(fixture.app)
      .get(plannerPath(scope, `ai-plans/${planId}`))
      .set('Cookie', admin.cookie);
    const adminReadJob = await request(fixture.app)
      .get(plannerPath(scope, `ai-jobs/${jobId}`))
      .set('Cookie', admin.cookie);
    const directAdminPlan = await fixture.service.getPlan(admin.id, scope, planId).catch((error: unknown) => error);
    const promptData = JSON.parse(providerCalls[0]!.prompt) as { request: { selectedTasks: Array<{
      reference: string;
      title: string;
      description: string;
      status: string;
      priority: string;
      assignee: string | null;
      dueDate: string | null;
      estimateMinMinutes: number | null;
      estimateMaxMinutes: number | null;
      plannedStartDate: string | null;
    }> } };

    expect(job.creatorId).toBe(owner.id);
    expect(job.credentialRevision).toBe(ownerRevision);
    expect(JSON.stringify(job)).not.toContain(ownerKey);
    expect(plan.activeVersionId).toBe(version.id);
    expect(version.draft).toMatchObject({ source: 'GENERATED', items: [{ title: 'Define API contract' }] });
    expect((job.stages as Array<{ status: string }>).map(({ status }) => status)).toEqual(Array(5).fill('completed'));
    expect(providerCalls.map(({ operation }) => operation)).toEqual(['understand', 'generate']);
    expect(providerCalls.every(({ apiKey }) => apiKey === ownerKey)).toBe(true);
    expect(promptData.request.selectedTasks).toEqual([{
      reference: 'existing-01',
      title: 'Selected launch checklist',
      description: 'Keep this context in the chosen team only.',
      status: 'TODO',
      priority: 'MEDIUM',
      assignee: null,
      dueDate: null,
      estimateMinMinutes: null,
      estimateMaxMinutes: null,
      plannedStartDate: null,
    }]);
    expect(JSON.stringify(providerCalls.map(({ prompt }) => prompt))).not.toContain(owner.email);
    expect(JSON.stringify(providerCalls.map(({ prompt }) => prompt))).not.toContain(admin.email);
    expect(await prisma.task.count()).toBe(taskCountBefore);
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events.map(({ payload }) => payload))).not.toContain(ownerKey);
    expect(JSON.stringify(events.map(({ payload }) => payload))).not.toContain('Build a small task management API');
    expect(Buffer.from(ownerCredential.ciphertext)).not.toEqual(Buffer.from(ownerKey));
    expect(adminReadPlan.status).toBe(404);
    expect(directAdminPlan).toMatchObject({ statusCode: 404 });
    expect(adminReadJob.status).toBe(404);
    expect(job.quotaSettled).toBe(true);
    expect(job.providerAttempts).toBe(2);
  });

  it('supports one clarification round with at most three questions and stores answers before generation resumes', async () => {
    const firstUnderstanding = {
      ...successfulUnderstanding,
      questions: ['Which release window should the team target?', 'Is a launch review required?'],
    };
    provider = new FakeGeminiProvider({ understanding: [{ value: firstUnderstanding, usage: { inputTokens: 20, outputTokens: 10 } }] });
    fixture = createPlannerTestApp({ prisma, logger, environment, provider });
    const user = await createUser('clarification@example.com');
    const scope = await createScope(user);
    await storeCredential(user.id, 'fake-gemini-key-ClarificationTestKey-0123456789');
    const created = await createJob(user, scope, goalInput('request-clarify-0001'));
    const { jobId } = created.body.data as { jobId: string };

    await fixture.runner.start();
    await waitForJobStatus(jobId, 'NEEDS_CLARIFICATION');
    await prisma.aiJob.update({
      where: { id: jobId },
      data: { startedAt: new Date(Date.now() - environment.AI_JOB_TIMEOUT_MS - 60_000) },
    });
    const snapshot = await request(fixture.app).get(plannerPath(scope, `ai-jobs/${jobId}`)).set('Cookie', user.cookie);
    await fixture.service.getJob(user.id, scope, jobId);
    const invalidAnswers = await request(fixture.app)
      .post(plannerPath(scope, `ai-jobs/${jobId}/clarify`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', user.cookie)
      .send({ requestKey: 'clarify-invalid-0001', answers: ['A', 'B', 'C', 'D'] });
    const clarified = await request(fixture.app)
      .post(plannerPath(scope, `ai-jobs/${jobId}/clarify`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', user.cookie)
      .send({ requestKey: 'clarify-valid-0001', answers: ['Target the October release and include a launch review.'] });
    const conflictingDuplicate = await request(fixture.app)
      .post(plannerPath(scope, `ai-jobs/${jobId}/clarify`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', user.cookie)
      .send({ requestKey: 'clarify-valid-0001', answers: ['Use a different release window.'] });

    expect(snapshot.status, JSON.stringify(snapshot.body)).toBe(200);
    expect(snapshot.body.data.clarificationQuestions).toEqual(firstUnderstanding.questions);
    expect(invalidAnswers.status).toBe(400);
    expect(clarified.status).toBe(202);
    expect(conflictingDuplicate.status).toBe(409);
    expect(conflictingDuplicate.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    await waitForJobStatus(jobId, 'SUCCEEDED');
    await fixture.runner.stop();

    expect(provider.calls.map(({ operation }) => operation)).toEqual(['understand', 'generate']);
    expect(provider.calls[1]?.prompt).toContain('Target the October release and include a launch review.');
    const repeatedClarification = await request(fixture.app)
      .post(plannerPath(scope, `ai-jobs/${jobId}/clarify`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', user.cookie)
      .send({ requestKey: 'clarify-second-round', allowAssumptions: true });
    expect(repeatedClarification.status).toBe(409);
    expect(repeatedClarification.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } })).checkpoint).toMatchObject({ clarificationRounds: 1 });
  });

  it('cancels queued work and recovers an unknown provider outcome without replaying a stale lease', async () => {
    const user = await createUser('recovery@example.com');
    const scope = await createScope(user);
    await storeCredential(user.id, 'fake-gemini-key-RecoveryTestKey-0123456789');
    const queued = await createJob(user, scope, goalInput('request-cancel-0001'));
    const queuedJobId = queued.body.data.jobId as string;
    const cancelled = await request(fixture.app)
      .post(plannerPath(scope, `ai-jobs/${queuedJobId}/cancel`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', user.cookie)
      .send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const submitted = await createJob(user, scope, goalInput('request-recover-0001'));
    const jobId = submitted.body.data.jobId as string;
    const repository = new AiJobRepository(prisma, fixture.contextService);
    const claimed = await repository.claimNext();
    expect(claimed?.job.id).toBe(jobId);
    await repository.startProviderAttempt(jobId, claimed!.leaseToken);
    await prisma.aiJob.update({
      where: { id: jobId },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    await repository.recoverExpired();
    const recovered = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
    const usage = await prisma.aiUsageDaily.findFirstOrThrow({ where: { scopeType: 'USER', scopeId: user.id } });
    await expect(repository.recordProviderResult(jobId, claimed!.leaseToken, {
      inputTokens: 1,
      outputTokens: 1,
    })).rejects.toBeInstanceOf(LeaseLostError);

    expect(recovered.status).toBe('INTERRUPTED');
    expect(recovered.safeErrorCode).toBe('AI_INTERRUPTED');
    expect(recovered.providerAttempts).toBe(1);
    expect(recovered.providerAttemptStartedAt).not.toBeNull();
    expect(recovered.quotaSettled).toBe(true);
    expect(recovered.inputTokensUsed).toBe(recovered.maxInputTokens);
    expect(recovered.outputTokensUsed).toBe(recovered.maxOutputTokens);
    expect(usage.operationsUsed).toBe(2);
    expect(usage.callsUsed).toBe(1);
    expect(usage.callsReserved).toBe(0);
    expect(provider.calls).toHaveLength(0);
  });

  it('keeps a rotated or deleted creator credential from reaching the provider', async () => {
    const user = await createUser('credential-revoked@example.com');
    const scope = await createScope(user);
    await storeCredential(user.id, 'fake-gemini-key-CredentialBeforeQueue-0123456789');
    const created = await createJob(user, scope, goalInput('request-credential-0001'));
    const jobId = created.body.data.jobId as string;
    await fixture.credentialRepository.delete(user.id);

    await fixture.runner.start();
    await waitForJobStatus(jobId, 'FAILED');
    await fixture.runner.stop();
    const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });

    expect(job.safeErrorCode).toBe('AI_CREDENTIAL_CHANGED');
    expect(job.providerAttempts).toBe(0);
    expect(job.quotaSettled).toBe(true);
    expect(provider.calls).toHaveLength(0);
  });

  it('enforces four provider attempts across explicit retries', async () => {
    provider = new FakeGeminiProvider({
      understanding: Array.from({ length: 4 }, () => new AiProviderError('AI_RATE_LIMITED')),
    });
    fixture = createPlannerTestApp({ prisma, logger, environment, provider });
    const user = await createUser('retry-limit@example.com');
    const scope = await createScope(user);
    await storeCredential(user.id, 'fake-gemini-key-RetryLimitTestKey-0123456789');
    const created = await createJob(user, scope, goalInput('request-retry-root-0001'));
    const rootJobId = created.body.data.jobId as string;

    await fixture.runner.start();
    let currentJobId = rootJobId;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await waitForJobStatus(currentJobId, 'FAILED');
      if (attempt < 4) {
        const retryRequestKey = `request-retry-${String(attempt).padStart(4, '0')}`;
        const retried = await request(fixture.app)
          .post(plannerPath(scope, `ai-plans/${created.body.data.planId}/generate`))
          .set('Origin', trustedTestOrigin)
          .set('Cookie', user.cookie)
          .send({
            requestKey: retryRequestKey,
            action: 'RETRY',
            retryJobId: currentJobId,
            baseVersionId: null,
          });
        expect(retried.status, JSON.stringify(retried.body)).toBe(202);
        currentJobId = retried.body.data.jobId as string;
      }
    }
    const deniedRetry = await request(fixture.app)
      .post(plannerPath(scope, `ai-plans/${created.body.data.planId}/generate`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', user.cookie)
      .send({ requestKey: 'request-retry-over-limit', action: 'RETRY', retryJobId: currentJobId, baseVersionId: null });
    await fixture.runner.stop();

    const attempts = await prisma.aiJob.aggregate({ where: { retryRootId: rootJobId }, _sum: { providerAttempts: true } });
    expect(deniedRetry.status).toBe(409);
    expect(deniedRetry.body.error.code).toBe('AI_RETRY_LIMIT_REACHED');
    expect(attempts._sum.providerAttempts).toBe(4);
    expect(provider.calls).toHaveLength(4);
  });

  it('settles the daily user quota once and rejects the eleventh operation', async () => {
    const user = await createUser('quota@example.com');
    const scope = await createScope(user);
    await storeCredential(user.id, 'fake-gemini-key-QuotaTestKey-0123456789');
    const parsedInput = createPlanSchema.parse(goalInput('quota-operation-0000'));

    for (let index = 0; index < 10; index += 1) {
      const created = await fixture.service.create(user.id, scope, {
        ...parsedInput,
        requestKey: `quota-operation-${String(index).padStart(4, '0')}`,
      });
      await fixture.service.cancel(user.id, scope, created.jobId);
    }
    await expect(fixture.service.create(user.id, scope, {
      ...parsedInput,
      requestKey: 'quota-operation-0010',
    })).rejects.toMatchObject({ statusCode: 429, code: 'AI_QUOTA_EXCEEDED' });

    const usage = await prisma.aiUsageDaily.findFirstOrThrow({ where: { scopeType: 'USER', scopeId: user.id } });
    expect(usage.operationsUsed).toBe(10);
    expect(usage.operationsReserved).toBe(0);
    expect(await prisma.aiJob.count()).toBe(10);
    expect(await prisma.aiJob.count({ where: { quotaSettled: false } })).toBe(0);
  });

  it('atomically enforces the shared workspace quota under concurrent creators', async () => {
    const owner = await createUser('workspace-quota-owner@example.com');
    const scope = await createScope(owner);
    const users = await Promise.all(Array.from({ length: 31 }, async (_, index) => prisma.user.create({
      data: {
        email: `workspace-quota-${String(index).padStart(2, '0')}@example.com`,
        passwordHash: 'test-only-password-hash',
        displayName: `Quota member ${index + 1}`,
      },
      select: { id: true },
    })));
    await prisma.workspaceMember.createMany({
      data: users.map(({ id }) => ({ workspaceId: scope.workspaceId, userId: id, role: 'MEMBER' as const })),
    });
    await prisma.teamMember.createMany({
      data: users.map(({ id }) => ({ workspaceId: scope.workspaceId, teamId: scope.teamId, userId: id })),
    });
    await Promise.all(users.map(({ id }, index) => storeCredential(id, `fake-gemini-key-WorkspaceQuota${String(index).padStart(2, '0')}Key-0123456789`)));
    const attempts = await Promise.allSettled(users.map(({ id }, index) => fixture.service.create(id, scope, createPlanSchema.parse(
      goalInput(`workspace-quota-${String(index).padStart(4, '0')}`),
    ))));
    const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
    const usage = await prisma.aiUsageDaily.findFirstOrThrow({
      where: { scopeType: 'WORKSPACE', scopeId: scope.workspaceId },
    });

    expect(fulfilled).toHaveLength(30);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ status: 'rejected', reason: { statusCode: 429, code: 'AI_QUOTA_EXCEEDED' } });
    expect(usage.operationsReserved).toBe(30);
    expect(usage.operationsUsed).toBe(0);
    expect(await prisma.aiJob.count()).toBe(30);
    expect(await prisma.aiPlan.count()).toBe(30);
  });
});
