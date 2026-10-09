import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { PlanDraftContent, PlannerFieldLock } from '../../src/modules/planner/version.schemas.js';
import { encryptCredential } from '../../src/shared/security/credential-crypto.js';
import { createPlannerTestApp, createPlannerTestEnvironment, plannerTestKeyring } from '../helpers/planner-app.js';
import { createTestDatabase, resetTestDatabase } from '../helpers/db.js';
import { AiRetentionRepository } from '../../src/modules/planner/retention.repository.js';
import { createTestWorkspace, registerTestUser, trustedTestOrigin } from '../helpers/core-app.js';
import { FakeGeminiProvider, successfulPlan } from '../fakes/fake-gemini.js';

const prisma: PrismaClient = createTestDatabase();
const logger = pino({ level: 'silent' });
const environment = {
  ...createPlannerTestEnvironment(),
  AI_PROVIDER_TIMEOUT_MS: 30_000,
  AI_JOB_TIMEOUT_MS: 60_000,
};
const consent = {
  providerDisclosureAccepted: true,
  billingAuthorityConfirmed: true,
  selectedContextReviewed: true,
};

type Fixture = ReturnType<typeof createPlannerTestApp>;
type User = { id: string; cookie: string; email: string };
type Scope = { workspaceId: string; teamId: string };
type GeneratedPlan = {
  user: User;
  scope: Scope;
  planId: string;
  versionId: string;
  draft: PlanDraftContent;
};

let fixture: Fixture;
let provider: FakeGeminiProvider;

beforeAll(async () => prisma.$connect());

beforeEach(async () => {
  await resetTestDatabase(prisma);
  provider = new FakeGeminiProvider();
  fixture = createPlannerTestApp({ prisma, logger, environment, provider });
});

afterEach(async () => fixture.runner.stop());

afterAll(async () => {
  await prisma.$disconnect();
  await logger.flush();
});

function path(scope: Scope, endpoint: string): string {
  return `/api/workspaces/${scope.workspaceId}/teams/${scope.teamId}/${endpoint}`;
}

function planInput(requestKey: string, dates: { startDate: string; targetDate: string; durationDays: number } = { startDate: '', targetDate: '', durationDays: 1 }) {
  return {
    requestKey,
    goal: 'Build a small task management API that supports a two person team.',
    constraints: 'Keep the first release reviewable.',
    detailLevel: 'BALANCED',
    strategy: 'BALANCED',
    ...(dates.startDate ? dates : {}),
    consent,
  };
}

async function createUser(email: string): Promise<User> {
  return { ...(await registerTestUser(fixture.app, email)), email };
}

async function createScope(user: User): Promise<Scope> {
  const workspace = await createTestWorkspace(fixture.app, user.cookie, 'Versioning integration workspace');
  const team = await request(fixture.app)
    .post(`/api/workspaces/${workspace.id}/teams`)
    .set('Origin', trustedTestOrigin)
    .set('Cookie', user.cookie)
    .send({ name: 'Plan editors' });
  expect(team.status, JSON.stringify(team.body)).toBe(201);
  return { workspaceId: workspace.id, teamId: team.body.data.id as string };
}

async function storeCredential(userId: string): Promise<void> {
  const encrypted = encryptCredential({
    plaintext: `AIzaSyVersionTest${userId.slice(0, 12)}Key-0123456789`,
    userId,
    provider: 'GEMINI',
    keyVersion: plannerTestKeyring.activeVersion,
    key: plannerTestKeyring.key,
  });
  await fixture.credentialRepository.upsert(userId, encrypted, 'gemini-test-model', new Date('2026-10-09T00:00:00.000Z'));
}

function withoutVersionMetadata(stored: unknown): PlanDraftContent {
  const content = structuredClone(stored) as Record<string, unknown>;
  delete content.schemaVersion;
  delete content.source;
  delete content.fieldLocks;
  return content as unknown as PlanDraftContent;
}

async function saveVersion(input: {
  user: User;
  scope: Scope;
  planId: string;
  expectedActiveVersionId: string | null;
  draft: PlanDraftContent;
  fieldLocks?: PlannerFieldLock[];
}) {
  return request(fixture.app)
    .post(path(input.scope, `ai-plans/${input.planId}/versions`))
    .set('Origin', trustedTestOrigin)
    .set('Cookie', input.user.cookie)
    .send({
      expectedActiveVersionId: input.expectedActiveVersionId,
      draft: input.draft,
      fieldLocks: input.fieldLocks ?? [],
    });
}

async function generatePlan(userEmail: string, requestKey: string, input = planInput(requestKey), timeoutMs = 5_000): Promise<GeneratedPlan> {
  const user = await createUser(userEmail);
  const scope = await createScope(user);
  await storeCredential(user.id);
  const created = await request(fixture.app)
    .post(path(scope, 'ai-plans'))
    .set('Origin', trustedTestOrigin)
    .set('Cookie', user.cookie)
    .send(input);
  expect(created.status, JSON.stringify(created.body)).toBe(202);
  const { jobId, planId } = created.body.data as { jobId: string; planId: string };

  await fixture.runner.start();
  await waitForJobStatus(jobId, 'SUCCEEDED', timeoutMs);
  await fixture.runner.stop();

  const plan = await request(fixture.app).get(path(scope, `ai-plans/${planId}`)).set('Cookie', user.cookie);
  expect(plan.status, JSON.stringify(plan.body)).toBe(200);
  const versionId = plan.body.data.activeVersionId as string;
  const draft = withoutVersionMetadata(plan.body.data.version.draft);
  return { user, scope, planId, versionId, draft };
}

async function waitForJobStatus(jobId: string, expected: string, timeoutMs = 5_000): Promise<void> {
  const endAt = Date.now() + timeoutMs;
  let latest: Awaited<ReturnType<typeof prisma.aiJob.findUnique>> = null;
  while (Date.now() < endAt) {
    latest = await prisma.aiJob.findUnique({ where: { id: jobId } });
    if (latest?.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for job ${jobId} to become ${expected}; latest=${latest?.status ?? 'missing'}; safeError=${latest?.safeErrorCode ?? 'none'}; stage=${latest?.currentStage ?? 'none'}.`);
}

describe('immutable AI plan versions and atomic confirmation', () => {
  it('uses active-version CAS for manual edits and never mutates prior snapshots', async () => {
    const plan = await generatePlan('version-cas@example.com', 'version-create-0001');
    const original = structuredClone(plan.draft);
    const item = plan.draft.items[0]!;
    item.title = 'Manually reviewed API contract';
    item.description = 'The human edited this version and locked its title.';
    const locks: PlannerFieldLock[] = [{ itemId: item.id, field: 'title' }];

    const saved = await saveVersion({
      user: plan.user,
      scope: plan.scope,
      planId: plan.planId,
      expectedActiveVersionId: plan.versionId,
      draft: plan.draft,
      fieldLocks: locks,
    });
    const newVersionId = saved.body.data.id as string;
    const oldVersion = await request(fixture.app)
      .get(path(plan.scope, `ai-plans/${plan.planId}/versions/${plan.versionId}`))
      .set('Cookie', plan.user.cookie);
    const stale = await saveVersion({
      user: plan.user,
      scope: plan.scope,
      planId: plan.planId,
      expectedActiveVersionId: plan.versionId,
      draft: original,
    });
    const refreshedPlan = await request(fixture.app)
      .get(path(plan.scope, `ai-plans/${plan.planId}`))
      .set('Cookie', plan.user.cookie);
    const history = await request(fixture.app)
      .get(path(plan.scope, `ai-plans/${plan.planId}/versions`))
      .set('Cookie', plan.user.cookie);

    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(history.status).toBe(200);
    expect(history.body.data.map((version: { ordinal: number }) => version.ordinal)).toEqual([2, 1]);
    expect(saved.body.data).toMatchObject({ ordinal: 2, source: 'EDITED', active: true, fieldLocks: locks });
    expect(oldVersion.status).toBe(200);
    expect(withoutVersionMetadata(oldVersion.body.data.draft)).toEqual(original);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(await prisma.aiPlanVersion.count({ where: { planId: plan.planId } })).toBe(2);
    expect(refreshedPlan.body.data.activeVersionId).toBe(newVersionId);
  });

  it('keeps field locks when creating a targeted candidate and requires base-version activation CAS', async () => {
    const first = successfulPlan();
    const revised = successfulPlan();
    revised.items[0] = { ...revised.items[0]!, title: 'AI proposed title', description: 'AI proposed description.' };
    provider = new FakeGeminiProvider({ generation: [
      { value: first, usage: { inputTokens: 100, outputTokens: 80 } },
      { value: revised, usage: { inputTokens: 100, outputTokens: 80 } },
    ] });
    fixture = createPlannerTestApp({ prisma, logger, environment, provider });
    const plan = await generatePlan('candidate-lock@example.com', 'candidate-create-0001');
    const item = plan.draft.items[0]!;
    item.title = 'Human locked title';
    item.description = 'The base description.';
    const lock: PlannerFieldLock = { itemId: item.id, field: 'title' };
    const edited = await saveVersion({
      user: plan.user,
      scope: plan.scope,
      planId: plan.planId,
      expectedActiveVersionId: plan.versionId,
      draft: plan.draft,
      fieldLocks: [lock],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(201);
    const baseVersionId = edited.body.data.id as string;
    const generation = await request(fixture.app)
      .post(path(plan.scope, `ai-plans/${plan.planId}/generate`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send({
        requestKey: 'candidate-regenerate-0001',
        action: 'REGENERATE',
        baseVersionId,
        itemIds: [item.id],
        fieldMask: ['title', 'description'],
        overrideLocks: [],
      });
    expect(generation.status, JSON.stringify(generation.body)).toBe(202);
    const jobId = generation.body.data.jobId as string;
    await fixture.runner.start();
    await waitForJobStatus(jobId, 'SUCCEEDED');
    await fixture.runner.stop();
    const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
    const candidate = await request(fixture.app)
      .get(path(plan.scope, `ai-plans/${plan.planId}/versions/${job.outputVersionId as string}`))
      .set('Cookie', plan.user.cookie);
    const beforeActivation = await request(fixture.app).get(path(plan.scope, `ai-plans/${plan.planId}`)).set('Cookie', plan.user.cookie);
    const activation = await request(fixture.app)
      .post(path(plan.scope, `ai-plans/${plan.planId}/versions/${job.outputVersionId as string}/activate`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send({ expectedActiveVersionId: baseVersionId });
    const staleActivation = await request(fixture.app)
      .post(path(plan.scope, `ai-plans/${plan.planId}/versions/${job.outputVersionId as string}/activate`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send({ expectedActiveVersionId: baseVersionId });
    const afterActivation = await request(fixture.app).get(path(plan.scope, `ai-plans/${plan.planId}`)).set('Cookie', plan.user.cookie);

    expect(candidate.status).toBe(200);
    expect(candidate.body.data.draft.items[0]).toMatchObject({ title: 'Human locked title', description: 'AI proposed description.' });
    expect(candidate.body.data.fieldLocks).toEqual([lock]);
    expect(candidate.body.data.baseVersionId).toBe(baseVersionId);
    expect(beforeActivation.body.data.activeVersionId).toBe(baseVersionId);
    expect(activation.status).toBe(200);
    expect(activation.body.data.activeVersionId).toBe(job.outputVersionId);
    expect(staleActivation.status).toBe(409);
    expect(staleActivation.body.error.code).toBe('VERSION_CONFLICT');
    expect(afterActivation.body.data.activeVersionId).toBe(job.outputVersionId);
  });

  it('creates a deadline-adjustment candidate that changes only schedule and remains pending review', async () => {
    const initial = successfulPlan();
    initial.items[0] = { ...initial.items[0]!, schedule: { mode: 'RELATIVE', startDay: 1, dueDay: 5 } };
    const adjusted = successfulPlan();
    adjusted.items[0] = {
      ...adjusted.items[0]!,
      title: 'Provider title must not replace the reviewed title',
      schedule: { mode: 'RELATIVE', startDay: 2, dueDay: 9 },
    };
    provider = new FakeGeminiProvider({ generation: [
      { value: initial, usage: { inputTokens: 100, outputTokens: 80 } },
      { value: adjusted, usage: { inputTokens: 100, outputTokens: 80 } },
    ] });
    fixture = createPlannerTestApp({ prisma, logger, environment, provider });
    const plan = await generatePlan('deadline-adjustment@example.com', 'deadline-create-0001', planInput(
      'deadline-create-0001', { startDate: '2026-10-09', targetDate: '2026-10-23', durationDays: 15 },
    ), 15_000);
    const item = plan.draft.items[0]!;
    item.title = 'Human reviewed title';
    const lock: PlannerFieldLock = { itemId: item.id, field: 'title' };
    const saved = await saveVersion({
      user: plan.user,
      scope: plan.scope,
      planId: plan.planId,
      expectedActiveVersionId: plan.versionId,
      draft: plan.draft,
      fieldLocks: [lock],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    const baseVersionId = saved.body.data.id as string;
    const generated = await request(fixture.app)
      .post(path(plan.scope, `ai-plans/${plan.planId}/generate`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send({
        requestKey: 'deadline-adjustment-0001',
        action: 'ADJUST_DEADLINE',
        baseVersionId,
        itemIds: [item.id],
        fieldMask: ['schedule'],
        deadline: '2026-10-19',
        overrideLocks: [],
      });
    expect(generated.status, JSON.stringify(generated.body)).toBe(202);
    const jobId = generated.body.data.jobId as string;
    await fixture.runner.start();
    await waitForJobStatus(jobId, 'SUCCEEDED', 12_000);
    await fixture.runner.stop();
    const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
    const candidate = await request(fixture.app)
      .get(path(plan.scope, `ai-plans/${plan.planId}/versions/${job.outputVersionId as string}`))
      .set('Cookie', plan.user.cookie);
    const latestPlan = await request(fixture.app).get(path(plan.scope, `ai-plans/${plan.planId}`)).set('Cookie', plan.user.cookie);

    expect((job.input as { targetDate?: string }).targetDate).toBe('2026-10-19');
    expect(provider.calls.at(-1)?.prompt).toContain('"targetDate":"2026-10-19"');
    expect(candidate.status).toBe(200);
    expect(candidate.body.data.source).toBe('ADJUSTED');
    expect(candidate.body.data.baseVersionId).toBe(baseVersionId);
    expect(candidate.body.data.fieldLocks).toEqual([lock]);
    expect(candidate.body.data.draft.items[0]).toMatchObject({
      title: 'Human reviewed title',
      schedule: { mode: 'RELATIVE', startDay: 2, dueDay: 9 },
    });
    expect(latestPlan.body.data.activeVersionId).toBe(baseVersionId);
  }, 20_000);

  it('clones an immutable plan once with fresh item IDs, cleared selections/assignees, and remapped dependencies', async () => {
    const plan = await generatePlan('clone-plan@example.com', 'clone-source-0001');
    const assignee = await createUser('clone-assignee@example.com');
    const workspaceMembership = await request(fixture.app)
      .post(`/api/workspaces/${plan.scope.workspaceId}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send({ email: assignee.email });
    expect(workspaceMembership.status).toBe(201);
    const teamMembership = await request(fixture.app)
      .post(`/api/workspaces/${plan.scope.workspaceId}/teams/${plan.scope.teamId}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send({ userId: assignee.id });
    expect(teamMembership.status).toBe(201);
    const parent = plan.draft.items[0]!;
    parent.selected = true;
    parent.assigneeId = assignee.id;
    const childId = randomUUID();
    plan.draft.items.push({
      ...structuredClone(parent),
      id: childId,
      title: 'Implement the API contract',
      dependencies: [parent.id],
      position: 1,
    });
    const edited = await saveVersion({
      user: plan.user,
      scope: plan.scope,
      planId: plan.planId,
      expectedActiveVersionId: plan.versionId,
      draft: plan.draft,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(201);

    const clonePath = path(plan.scope, `ai-plans/${plan.planId}/clone`);
    const firstClone = await request(fixture.app)
      .post(clonePath)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send({ requestKey: 'clone-plan-request-0001' });
    const replay = await request(fixture.app)
      .post(clonePath)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send({ requestKey: 'clone-plan-request-0001' });
    expect(firstClone.status, JSON.stringify(firstClone.body)).toBe(201);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.data.planId).toBe(firstClone.body.data.planId);
    expect(await prisma.aiPlan.count()).toBe(2);

    const clone = await request(fixture.app)
      .get(path(plan.scope, `ai-plans/${firstClone.body.data.planId as string}`))
      .set('Cookie', plan.user.cookie);
    expect(clone.status).toBe(200);
    const clonedDraft = withoutVersionMetadata(clone.body.data.version.draft);
    const oldIds = new Set(plan.draft.items.map((item) => item.id));
    const clonedByTitle = new Map(clonedDraft.items.map((item) => [item.title, item]));
    const clonedParent = clonedByTitle.get(parent.title)!;
    const clonedChild = clonedByTitle.get('Implement the API contract')!;
    expect(clonedDraft.items).toHaveLength(2);
    expect(clonedDraft.items.every((item) => !oldIds.has(item.id))).toBe(true);
    expect(clonedDraft.items.every((item) => !item.selected && item.assigneeId === null)).toBe(true);
    expect(clonedChild.dependencies).toEqual([clonedParent.id]);
    expect(clonedDraft.warnings.join(' ')).toContain('Previous assignments and linked existing tasks were not copied.');
    expect(await prisma.aiPlanVersion.count()).toBe(3);
  });

  it('rejects confirmation when a reviewed context task changes after generation', async () => {
    const user = await createUser('stale-context@example.com');
    const scope = await createScope(user);
    const existingTask = await request(fixture.app)
      .post(path(scope, 'tasks'))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', user.cookie)
      .send({ title: 'Reviewed existing task', description: 'This task is included in the AI context.' });
    expect(existingTask.status, JSON.stringify(existingTask.body)).toBe(201);
    await storeCredential(user.id);

    const created = await request(fixture.app)
      .post(path(scope, 'ai-plans'))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', user.cookie)
      .send({
        ...planInput('stale-context-plan-0001'),
        includeExistingTasks: true,
        existingTaskIds: [existingTask.body.data.id as string],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(202);
    const { jobId, planId } = created.body.data as { jobId: string; planId: string };
    await fixture.runner.start();
    await waitForJobStatus(jobId, 'SUCCEEDED');
    await fixture.runner.stop();

    const planResponse = await request(fixture.app).get(path(scope, `ai-plans/${planId}`)).set('Cookie', user.cookie);
    const versionId = planResponse.body.data.activeVersionId as string;
    const draft = withoutVersionMetadata(planResponse.body.data.version.draft);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const changedTask = await request(fixture.app)
      .patch(path(scope, `tasks/${existingTask.body.data.id as string}`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', user.cookie)
      .send({ description: 'The task changed after review.' });
    expect(changedTask.status, JSON.stringify(changedTask.body)).toBe(200);

    const confirm = await request(fixture.app)
      .post(path(scope, `ai-plans/${planId}/confirm`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', user.cookie)
      .send({
        versionId,
        selectedItemIds: draft.items.filter((item) => item.selected).map((item) => item.id),
        requestKey: 'stale-context-confirm-0001',
      });
    expect(confirm.status).toBe(409);
    expect(confirm.body.error.code).toBe('AI_CONTEXT_STALE');
    expect(await prisma.task.count()).toBe(1);
    expect(await prisma.aiImportReceipt.count()).toBe(0);
    expect((await prisma.aiPlan.findUniqueOrThrow({ where: { id: planId } })).status).toBe('DRAFT');
  });

  it('rejects partial imports, atomically maps selected tasks and schedule data, and replays receipts without resurrection', async () => {
    const plan = await generatePlan('confirm-atomic@example.com', 'confirm-create-0001');
    const originalVersion = plan.versionId;
    const parent = plan.draft.items[0]!;
    const childId = randomUUID();
    parent.selected = false;
    parent.schedule = { mode: 'ABSOLUTE', startDate: '2026-10-10', dueDate: '2026-10-20' };
    parent.completionCriteria = 'The API contract has reviewer sign-off.';
    parent.priorityReason = 'The implementation depends on this contract.';
    parent.estimateMinMinutes = 60;
    parent.estimateMaxMinutes = 120;
    parent.checklist = ['List endpoints', 'Review payloads'];
    plan.draft.items.push({
      ...structuredClone(parent),
      id: childId,
      title: 'Implement the reviewed contract',
      description: 'Build only after the prerequisite is complete.',
      completionCriteria: 'The endpoints pass the acceptance checks.',
      priorityReason: 'Implementation follows contract review.',
      priority: 'MEDIUM',
      estimateMinMinutes: 90,
      estimateMaxMinutes: 180,
      schedule: { mode: 'RELATIVE', startDay: 3, dueDay: 7 },
      dependencies: [parent.id],
      checklist: ['Implement endpoints'],
      selected: true,
      position: 1,
    });

    const firstEdit = await saveVersion({
      user: plan.user, scope: plan.scope, planId: plan.planId,
      expectedActiveVersionId: originalVersion, draft: plan.draft,
    });
    expect(firstEdit.status, JSON.stringify(firstEdit.body)).toBe(201);
    const unselectedPrerequisiteVersion = firstEdit.body.data.id as string;
    const invalidConfirm = await request(fixture.app)
      .post(path(plan.scope, `ai-plans/${plan.planId}/confirm`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send({
        versionId: unselectedPrerequisiteVersion,
        selectedItemIds: [childId],
        requestKey: 'confirm-invalid-0001',
      });
    const beforeValidConfirm = await prisma.aiPlan.findUniqueOrThrow({ where: { id: plan.planId } });
    expect(invalidConfirm.status).toBe(422);
    expect(invalidConfirm.body.error.code).toBe('DEPENDENCY_NOT_SELECTED');
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.taskChecklist.count()).toBe(0);
    expect(await prisma.taskDependency.count()).toBe(0);
    expect(await prisma.aiImportReceipt.count()).toBe(0);
    expect(beforeValidConfirm.status).toBe('DRAFT');

    const selectedDraft = structuredClone(plan.draft);
    selectedDraft.items.forEach((item) => { item.selected = true; });
    const finalEdit = await saveVersion({
      user: plan.user, scope: plan.scope, planId: plan.planId,
      expectedActiveVersionId: unselectedPrerequisiteVersion, draft: selectedDraft,
    });
    expect(finalEdit.status, JSON.stringify(finalEdit.body)).toBe(201);
    const versionId = finalEdit.body.data.id as string;
    const confirmBody = {
      versionId,
      selectedItemIds: selectedDraft.items.map((item) => item.id),
      requestKey: 'confirm-valid-0001',
    };
    const sendConfirmation = () => request(fixture.app)
      .post(path(plan.scope, `ai-plans/${plan.planId}/confirm`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send(confirmBody);
    const concurrentConfirmations = await Promise.all([sendConfirmation(), sendConfirmation()]);
    const confirmed = concurrentConfirmations.find((response) => response.status === 201) ?? concurrentConfirmations[0]!;
    const concurrentReplay = concurrentConfirmations.find((response) => response !== confirmed)!;
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
    expect(concurrentReplay.status).toBe(200);
    expect(concurrentReplay.body.data).toEqual(confirmed.body.data);
    expect(confirmed.body.data).toMatchObject({ createdCount: 2, checklistItemCount: 3, dependencyCount: 1 });
    const itemTaskMap = confirmed.body.data.itemTaskMap as Array<{ itemId: string; taskId: string }>;
    const taskMap = new Map(itemTaskMap.map(({ itemId, taskId }) => [itemId, taskId]));
    const parentTaskId = taskMap.get(parent.id)!;
    const childTaskId = taskMap.get(childId)!;
    const importedParent = await prisma.task.findUniqueOrThrow({ where: { id: parentTaskId }, include: { checklist: { orderBy: { position: 'asc' } } } });
    const importedChild = await prisma.task.findUniqueOrThrow({ where: { id: childTaskId }, include: { checklist: { orderBy: { position: 'asc' } } } });
    const importedDependency = await prisma.taskDependency.findFirstOrThrow({ where: { taskId: childTaskId } });
    const receipt = await prisma.aiImportReceipt.findUniqueOrThrow({ where: { planId: plan.planId } });

    expect(importedParent).toMatchObject({
      status: 'TODO',
      completionCriteria: 'The API contract has reviewer sign-off.',
      priorityReason: 'The implementation depends on this contract.',
      estimateMinMinutes: 60,
      estimateMaxMinutes: 120,
      plannedStartDate: new Date('2026-10-10T00:00:00.000Z'),
      dueDate: new Date('2026-10-20T00:00:00.000Z'),
    });
    expect(importedParent.checklist.map(({ title }) => title)).toEqual(['List endpoints', 'Review payloads']);
    expect(importedChild).toMatchObject({ relativeStartDay: 3, relativeDueDay: 7, dueDate: null, plannedStartDate: null });
    expect(importedChild.checklist.map(({ title }) => title)).toEqual(['Implement endpoints']);
    expect(importedDependency).toMatchObject({ taskId: childTaskId, prerequisiteId: parentTaskId });
    expect(receipt.confirmedVersionId).toBe(versionId);
    expect((await prisma.aiPlan.findUniqueOrThrow({ where: { id: plan.planId } })).status).toBe('IMPORTED');

    const replayed = await request(fixture.app)
      .post(path(plan.scope, `ai-plans/${plan.planId}/confirm`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send(confirmBody);
    const conflictingReplay = await request(fixture.app)
      .post(path(plan.scope, `ai-plans/${plan.planId}/confirm`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send({ ...confirmBody, requestKey: 'confirm-other-request' });
    expect(replayed.status).toBe(200);
    expect(replayed.body.data).toEqual(confirmed.body.data);
    expect(conflictingReplay.status).toBe(409);
    expect(conflictingReplay.body.error.code).toBe('PLAN_ALREADY_IMPORTED');
    expect(await prisma.task.count()).toBe(2);
    expect(await prisma.aiImportReceipt.count()).toBe(1);

    const deleteChild = await request(fixture.app)
      .delete(path(plan.scope, `tasks/${childTaskId}`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie);
    const deleteParent = await request(fixture.app)
      .delete(path(plan.scope, `tasks/${parentTaskId}`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie);
    const replayAfterDeletion = await request(fixture.app)
      .post(path(plan.scope, `ai-plans/${plan.planId}/confirm`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send(confirmBody);
    expect(deleteChild.status).toBe(204);
    expect(deleteParent.status).toBe(204);
    expect(replayAfterDeletion.status).toBe(200);
    expect(replayAfterDeletion.body.data).toEqual(confirmed.body.data);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.aiImportReceipt.count()).toBe(1);
  });

  it('cancels queued work and purges full plan content after its retention deadline', async () => {
    const plan = await generatePlan('retention@example.com', 'retention-create-0001');
    const itemId = plan.draft.items[0]!.id;
    const queued = await request(fixture.app)
      .post(path(plan.scope, `ai-plans/${plan.planId}/generate`))
      .set('Origin', trustedTestOrigin)
      .set('Cookie', plan.user.cookie)
      .send({
        requestKey: 'retention-revision-0001',
        action: 'SIMPLIFY',
        baseVersionId: plan.versionId,
        itemIds: [itemId],
        fieldMask: ['description', 'checklist'],
        overrideLocks: [],
      });
    expect(queued.status, JSON.stringify(queued.body)).toBe(202);
    const queuedJobId = queued.body.data.jobId as string;
    const beforePurge = await prisma.aiJob.findUniqueOrThrow({ where: { id: queuedJobId } });
    expect(beforePurge.status).toBe('QUEUED');
    expect(JSON.stringify(beforePurge.input)).toContain('small task management API');

    await prisma.aiPlan.update({
      where: { id: plan.planId },
      data: { createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000), expiresAt: new Date(Date.now() - 1_000) },
    });
    const retention = new AiRetentionRepository(prisma);
    const result = await retention.purgeOneExpiredPlan();

    expect(result).toEqual({ purged: true, jobsCancelled: 1, jobsInterrupted: 0 });
    const expiredPlan = await prisma.aiPlan.findUniqueOrThrow({ where: { id: plan.planId } });
    const jobs = await prisma.aiJob.findMany({ where: { planId: plan.planId } });
    const versions = await prisma.aiPlanVersion.findMany({ where: { planId: plan.planId } });
    const cancelled = await prisma.aiJob.findUniqueOrThrow({ where: { id: queuedJobId } });

    expect(expiredPlan.purgedAt).not.toBeNull();
    expect(expiredPlan.status).toBe('EXPIRED');
    expect(cancelled).toMatchObject({ status: 'CANCELLED', safeErrorCode: 'AI_RETENTION_EXPIRED', quotaSettled: true });
    expect(cancelled.checkpoint).toBeNull();
    expect(jobs.every((job) => JSON.stringify(job.input) === JSON.stringify({ purged: true }))).toBe(true);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((version) => JSON.stringify(version.draft) === JSON.stringify({ purged: true }))).toBe(true);
    expect(versions.every((version) => JSON.stringify(version.inputSnapshot) === JSON.stringify({ purged: true }))).toBe(true);
    expect(versions.every((version) => version.contextSnapshot === null)).toBe(true);
    expect(await retention.purgeOneExpiredPlan()).toMatchObject({ purged: false });
  });
});
