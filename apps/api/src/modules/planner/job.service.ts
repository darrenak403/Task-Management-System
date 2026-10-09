import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, AiJob } from '../../generated/prisma/client.js';
import type { RuntimeEnvironment } from '../../shared/config/env.js';
import { resourceNotFound } from '../../shared/authorization/policy.js';
import { HttpError } from '../../shared/http/error-handler.js';
import type { GeminiCredentialRepository } from '../ai-credentials/credentials.repository.js';
import { appendRealtimeEvents } from '../realtime/outbox.js';
import type { PlannerContextService } from './context.service.js';
import type { CreatePlanInput } from './planner.schemas.js';
import { createPlanSchema } from './planner.schemas.js';
import { persistedCandidateSchema, plannerFieldLockSchema, planDraftContentSchema, type GenerateRevisionRequest, type PlannerFieldLock } from './version.schemas.js';
import { initialStages, PLANNER_STAGES, stageTransition, type PlannerStage } from './stage-catalog.js';
import { assertAiRuntimeAvailable, businessUsageDate, quotaScopes, reserveQuota, settleQuota, dailyUsage } from './quota.service.js';

const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING', 'NEEDS_CLARIFICATION'] as const;
const RETRY_ROOT_LIMIT = 4;
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

type Scope = { workspaceId: string; teamId: string };
type PersistedInput = CreatePlanInput & { consentVersion: string; contextSnapshot: unknown };
type Checkpoint = {
  understanding?: { summary: string; assumptions: string[]; questions: string[] };
  clarificationRounds?: number;
  clarificationAnswers?: string[];
  allowAssumptions?: boolean;
  clarificationRequestKey?: string;
  clarificationHash?: string;
  planOutput?: unknown;
  prioritizedOutput?: unknown;
  finalOutput?: unknown;
};

export class AiJobService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly environment: RuntimeEnvironment,
    private readonly credentialRepository: GeminiCredentialRepository,
    private readonly contextService: PlannerContextService,
    private readonly wakeWorker: () => void,
    private readonly abortJob: (jobId: string) => void,
  ) {}

  async status(userId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ quarantined: boolean }>>`
      SELECT quarantined FROM ai_runtime_control WHERE id = 1
    `;
    const credential = await this.credentialRepository.findByUserId(userId);
    const quarantined = rows[0]?.quarantined !== false;
    const credentialRequired = !credential?.verifiedAt;
    const modelRequired = Boolean(credential?.verifiedAt && !credential.model);
    const available = this.environment.AI_ENABLED && !quarantined && !credentialRequired && !modelRequired;
    return {
      available,
      model: credential?.model ?? null,
      credentialRequired,
      dailyUsage: await dailyUsage(this.prisma, userId),
      unavailableReason: quarantined ? 'restore_quarantine'
        : !this.environment.AI_ENABLED ? this.environment.aiUnavailableReason
          : credentialRequired ? 'credential_required' : modelRequired ? 'model_required' : this.environment.aiUnavailableReason,
    };
  }

  async create(userId: string, scope: Scope, input: CreatePlanInput): Promise<{ planId: string; jobId: string; status: string; requestKey: string }> {
    this.requireAvailable();
    const maxInputTokens = this.environment.AI_MAX_INPUT_TOKENS;
    const maxOutputTokens = this.environment.AI_MAX_OUTPUT_TOKENS;
    if (!maxInputTokens || !maxOutputTokens) throw unavailable();

    const normalized = { ...input };
    const { requestKey, ...hashableInput } = normalized;
    const requestHash = hashJson(hashableInput);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.contextService.lockAndCheckAccess(tx, userId, scope.workspaceId, scope.teamId);
        await lockUserQueue(tx, userId);
        const previous = await tx.aiJob.findFirst({ where: { creatorId: userId, ...scope, requestKey } });
        if (previous) {
          if (previous.requestHash !== requestHash) throw idempotencyConflict();
          return { planId: previous.planId, jobId: previous.id, status: previous.status, requestKey };
        }
        const credential = await tx.userGeminiCredential.findUnique({ where: { userId } });
        if (!credential?.verifiedAt) throw new HttpError(409, 'AI_CREDENTIAL_REQUIRED', 'Configure a verified Gemini credential before generating a plan.');
        if (!credential.model) throw new HttpError(409, 'AI_MODEL_REQUIRED', 'Select a Gemini model before generating a plan.');
        const active = await tx.aiJob.findFirst({ where: { creatorId: userId, status: { in: [...ACTIVE_JOB_STATUSES] } }, select: { id: true } });
        if (active) throw new HttpError(409, 'AI_JOB_ACTIVE', 'Finish or cancel the current AI plan request before starting another.');

        const contextSnapshot = await this.contextService.lockAndLoad(tx, userId, scope.workspaceId, scope.teamId, normalized);
        const usageDate = businessUsageDate();
        await reserveQuota(tx, {
          scopes: quotaScopes(userId, scope.workspaceId), usageDate, maxInputTokens, maxOutputTokens, maxAttempts: RETRY_ROOT_LIMIT,
        });

        const now = new Date();
        const plan = await tx.aiPlan.create({
          data: {
            workspaceId: scope.workspaceId, teamId: scope.teamId, creatorId: userId,
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
          },
        });
        const jobId = randomUUID();
        const jobInput: PersistedInput = { ...normalized, consentVersion: '2026-10', contextSnapshot };
        const job = await tx.aiJob.create({
          data: {
            id: jobId, planId: plan.id, workspaceId: scope.workspaceId, teamId: scope.teamId, creatorId: userId,
            credentialRevision: credential.credentialRevision, retryRootId: jobId, attemptLimit: RETRY_ROOT_LIMIT,
            usageDate, maxInputTokens, maxOutputTokens, requestKey, requestHash,
            input: json(jobInput), stages: json(initialStages()), model: credential.model,
            promptVersion: 'planner-v1', expiresAt: plan.expiresAt,
          },
        });
        await appendJobEvent(tx, job, 'Plan preparation was queued.');
        return { planId: plan.id, jobId: job.id, status: job.status, requestKey };
      }, { timeout: 8_000, maxWait: 5_000 });
      this.wakeWorker();
      return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const previous = await this.prisma.aiJob.findFirst({ where: { creatorId: userId, ...scope, requestKey } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw idempotencyConflict();
        return { planId: previous.planId, jobId: previous.id, status: previous.status, requestKey };
      }
      throw new HttpError(409, 'AI_JOB_ACTIVE', 'Finish or cancel the current AI plan request before starting another.');
    }
  }

  async getPlan(userId: string, scope: Scope, planId: string) {
    await this.contextService.assertCurrentAccess(userId, scope.workspaceId, scope.teamId);
    const plan = await this.prisma.aiPlan.findFirst({
      where: { id: planId, ...scope, creatorId: userId },
      include: {
        jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, currentStage: true, sequence: true } },
        importReceipt: { select: { confirmedVersionId: true, itemTaskMap: true, response: true, committedAt: true } },
      },
    });
    if (!plan) throw resourceNotFound();
    if ((plan.expiresAt <= new Date() || plan.purgedAt) && !plan.importReceipt) throw new HttpError(410, 'PLAN_EXPIRED', 'This plan has expired.');
    const activeVersion = !plan.purgedAt && plan.activeVersionId
      ? await this.prisma.aiPlanVersion.findFirst({ where: { id: plan.activeVersionId, planId: plan.id } })
      : null;
    return {
      data: {
        id: plan.id, workspaceId: plan.workspaceId, teamId: plan.teamId, status: plan.status,
        activeVersionId: plan.activeVersionId, createdAt: plan.createdAt.toISOString(), expiresAt: plan.expiresAt.toISOString(),
        latestJob: plan.jobs[0] ?? null,
        importReceipt: plan.importReceipt ? {
          confirmedVersionId: plan.importReceipt.confirmedVersionId,
          itemTaskMap: plan.importReceipt.itemTaskMap,
          response: plan.importReceipt.response,
          committedAt: plan.importReceipt.committedAt.toISOString(),
        } : null,
        version: activeVersion ? {
          id: activeVersion.id, ordinal: activeVersion.ordinal, source: activeVersion.source,
          draft: activeVersion.draft, contentHash: activeVersion.contentHash, createdAt: activeVersion.createdAt.toISOString(),
        } : null,
      },
    };
  }

  async generateRevision(userId: string, scope: Scope, planId: string, input: GenerateRevisionRequest) {
    this.requireAvailable();
    const maxInputTokens = this.environment.AI_MAX_INPUT_TOKENS;
    const maxOutputTokens = this.environment.AI_MAX_OUTPUT_TOKENS;
    if (!maxInputTokens || !maxOutputTokens) throw unavailable();
    const { requestKey, ...request } = input;
    const requestHash = hashJson({ planId, ...request });

    const result = await this.prisma.$transaction(async (tx) => {
      await this.contextService.lockAndCheckAccess(tx, userId, scope.workspaceId, scope.teamId);
      await lockUserQueue(tx, userId);
      const previous = await tx.aiJob.findFirst({ where: { creatorId: userId, ...scope, requestKey } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw idempotencyConflict();
        return { planId: previous.planId, jobId: previous.id, status: previous.status, requestKey };
      }

      const planRows = await tx.$queryRaw<Array<{ id: string; status: string; active_version_id: string | null; expires_at: Date }>>`
        SELECT id, status::text AS status, active_version_id, expires_at FROM ai_plans
        WHERE id = ${planId}::uuid AND creator_id = ${userId}::uuid
          AND workspace_id = ${scope.workspaceId}::uuid AND team_id = ${scope.teamId}::uuid
        FOR UPDATE
      `;
      const planRow = planRows[0];
      if (!planRow) throw resourceNotFound();
      if (planRow.status !== 'DRAFT' || planRow.expires_at <= new Date()) {
        throw new HttpError(410, 'PLAN_EXPIRED', 'This draft plan cannot be generated or revised.');
      }

      let sourceInput: unknown;
      let retryRootId: string;
      let attemptLimit = RETRY_ROOT_LIMIT;
      const jobId = randomUUID();
      let candidate: ReturnType<typeof persistedCandidateSchema.parse> | undefined;
      if (input.action === 'RETRY') {
        const retryJobId = input.retryJobId;
        if (!retryJobId) throw new HttpError(422, 'INVALID_RETRY', 'A retry must identify the failed job.');
        const original = await tx.aiJob.findFirst({ where: { id: retryJobId, planId, creatorId: userId, ...scope } });
        if (!original || !['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(original.status)) {
          throw new HttpError(409, 'AI_RETRY_NOT_AVAILABLE', 'Only a failed, interrupted, or cancelled job for this draft can be retried.');
        }
        if (planRow.active_version_id !== null) throw new HttpError(409, 'AI_RETRY_NOT_AVAILABLE', 'A plan with an active version must use a revision request.');
        sourceInput = original.input;
        retryRootId = original.retryRootId;
        const attempts = await tx.aiJob.aggregate({ where: { retryRootId }, _sum: { providerAttempts: true } });
        attemptLimit = RETRY_ROOT_LIMIT - (attempts._sum.providerAttempts ?? 0);
        if (attemptLimit <= 0) throw new HttpError(409, 'AI_RETRY_LIMIT_REACHED', 'This request has used its maximum provider attempts.');
      } else {
        if (!input.baseVersionId || planRow.active_version_id !== input.baseVersionId) throw new HttpError(409, 'VERSION_CONFLICT', 'The active version changed. Reload the plan before requesting a candidate.');
        const version = await tx.aiPlanVersion.findFirst({ where: { id: input.baseVersionId, planId } });
        if (!version) throw resourceNotFound();
        const baseDraft = planDraftContentSchema.safeParse(stripVersionMetadata(version.draft));
        const locks = plannerFieldLockSchema.array().safeParse(version.fieldLocks);
        if (!baseDraft.success || !locks.success) throw new HttpError(410, 'VERSION_EXPIRED', 'This plan version cannot be revised.');
        const targetIds = new Set(input.itemIds);
        if (input.itemIds.some((itemId) => !baseDraft.data.items.some((item) => item.id === itemId))) {
          throw new HttpError(422, 'INVALID_PLAN_ITEM', 'Every revision target must belong to the active plan version.');
        }
        const fieldMask = input.fieldMask.length > 0 ? input.fieldMask : defaultFieldMask(input.action);
        if (input.action === 'ADJUST_DEADLINE' && (fieldMask.length !== 1 || fieldMask[0] !== 'schedule')) {
          throw new HttpError(422, 'INVALID_FIELD_MASK', 'Deadline adjustment may change only schedule fields.');
        }
        const lockKeys = new Set(locks.data.map((lock) => `${lock.itemId}:${lock.field}`));
        if (input.overrideLocks.some((lock) => !lockKeys.has(`${lock.itemId}:${lock.field}`) || !targetIds.has(lock.itemId) || !fieldMask.includes(lock.field as (typeof fieldMask)[number]))) {
          throw new HttpError(422, 'INVALID_LOCK_OVERRIDE', 'Overrides must target a locked field included in this revision.');
        }
        const baseInput = readPlannerInput(version.inputSnapshot);
        if (!baseInput) throw new HttpError(409, 'AI_REVISION_UNAVAILABLE', 'This plan does not retain enough approved input to request a revision.');
        sourceInput = {
          ...baseInput,
          requestKey,
          ...(input.action === 'ADJUST_DEADLINE' ? { targetDate: input.deadline, durationDays: null } : {}),
          revision: persistedCandidateSchema.parse({
            action: input.action,
            baseVersionId: input.baseVersionId,
            itemIds: input.itemIds,
            fieldMask,
            overrideLocks: input.overrideLocks,
            fieldLocks: locks.data,
            baseDraft: baseDraft.data,
          }),
        };
        candidate = persistedCandidateSchema.parse((sourceInput as Record<string, unknown>).revision);
        retryRootId = jobId;
      }

      const active = await tx.aiJob.findFirst({ where: { creatorId: userId, status: { in: [...ACTIVE_JOB_STATUSES] } }, select: { id: true } });
      if (active) throw new HttpError(409, 'AI_JOB_ACTIVE', 'Finish or cancel the current AI plan request before starting another.');
      const credential = await tx.userGeminiCredential.findUnique({ where: { userId } });
      if (!credential?.verifiedAt) throw new HttpError(409, 'AI_CREDENTIAL_REQUIRED', 'Configure a verified Gemini credential before revising this plan.');
      if (!credential.model) throw new HttpError(409, 'AI_MODEL_REQUIRED', 'Select a Gemini model before revising this plan.');
      const usageDate = businessUsageDate();
      await reserveQuota(tx, { scopes: quotaScopes(userId, scope.workspaceId), usageDate, maxInputTokens, maxOutputTokens, maxAttempts: attemptLimit });
      if (candidate) {
        const estimatedInput = Buffer.byteLength(JSON.stringify(sourceInput), 'utf8');
        if (Math.ceil(estimatedInput / 3) > maxInputTokens) throw new HttpError(413, 'AI_INPUT_TOO_LARGE', 'The selected plan exceeds the configured token limit.');
      }
      const job = await tx.aiJob.create({
        data: {
          id: jobId, planId, workspaceId: scope.workspaceId, teamId: scope.teamId, creatorId: userId,
          credentialRevision: credential.credentialRevision, retryRootId, attemptLimit,
          usageDate, maxInputTokens, maxOutputTokens, action: 'RETRY', status: 'QUEUED', requestKey, requestHash,
          input: json(sourceInput), stages: json(initialStages()), model: credential.model,
          promptVersion: candidate ? 'planner-revision-v1' : 'planner-v1', expiresAt: planRow.expires_at,
        },
      });
      await appendJobEvent(tx, job, candidate ? 'A plan revision candidate was queued.' : 'The plan generation retry was queued.');
      return { planId: job.planId, jobId: job.id, status: job.status, requestKey };
    }, { timeout: 10_000, maxWait: 5_000 });
    this.wakeWorker();
    return { data: result };
  }

  async getJob(userId: string, scope: Scope, jobId: string) {
    await this.contextService.assertCurrentAccess(userId, scope.workspaceId, scope.teamId);
    const job = await this.prisma.aiJob.findFirst({ where: { id: jobId, creatorId: userId, ...scope } });
    if (!job) throw resourceNotFound();
    const checkpoint = isRecord(job.checkpoint) ? job.checkpoint as Checkpoint : {};
    return { data: publicJob(job, checkpoint) };
  }

  async findJobByRequestKey(userId: string, scope: Scope, requestKey: string) {
    await this.contextService.assertCurrentAccess(userId, scope.workspaceId, scope.teamId);
    const job = await this.prisma.aiJob.findFirst({ where: { creatorId: userId, ...scope, requestKey } });
    if (!job) throw resourceNotFound();
    const checkpoint = isRecord(job.checkpoint) ? job.checkpoint as Checkpoint : {};
    return { data: publicJob(job, checkpoint) };
  }

  async clarify(userId: string, scope: Scope, jobId: string, input: {
    requestKey: string; answers?: string[] | undefined; allowAssumptions?: boolean | undefined;
  }) {
    const { requestKey, ...answers } = input;
    const requestHash = hashJson(answers);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.contextService.lockAndCheckAccess(tx, userId, scope.workspaceId, scope.teamId);
      await assertAiRuntimeAvailable(tx);
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ai_jobs WHERE id = ${jobId}::uuid AND creator_id = ${userId}::uuid
          AND workspace_id = ${scope.workspaceId}::uuid AND team_id = ${scope.teamId}::uuid FOR UPDATE
      `;
      if (!locked[0]) throw resourceNotFound();
      const job = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      const checkpoint = isRecord(job.checkpoint) ? job.checkpoint as Checkpoint : {};
      if (checkpoint.clarificationRequestKey) {
        if (checkpoint.clarificationRequestKey !== requestKey || checkpoint.clarificationHash !== requestHash) throw idempotencyConflict();
        return { id: job.id, status: job.status };
      }
      if (job.status !== 'NEEDS_CLARIFICATION' || !checkpoint.understanding || (checkpoint.clarificationRounds ?? 0) >= 1) {
        throw new HttpError(409, 'CLARIFICATION_NOT_AVAILABLE', 'This job is not waiting for clarification.');
      }
      const nextCheckpoint: Checkpoint = {
        ...checkpoint,
        ...(answers.answers ? { clarificationAnswers: answers.answers } : {}),
        ...(answers.allowAssumptions !== undefined ? { allowAssumptions: answers.allowAssumptions } : {}),
        clarificationRounds: 1,
        clarificationRequestKey: requestKey,
        clarificationHash: requestHash,
      };
      const stages = stageTransition(job.stages, 'understanding_goal', 'completed', new Date(), 'The clarification was provided.');
      const updated = await tx.aiJob.update({
        where: { id: job.id },
        data: { status: 'QUEUED', action: 'CLARIFY', currentStage: 'breaking_down_work', stages: json(stages), checkpoint: json(nextCheckpoint), sequence: { increment: 1 } },
      });
      await appendJobEvent(tx, updated, 'Clarification was received; generation is resuming.');
      return { id: updated.id, status: updated.status };
    }, { timeout: 8_000 });
    this.wakeWorker();
    return { data: result };
  }

  async cancel(userId: string, scope: Scope, jobId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.contextService.lockAndCheckAccess(tx, userId, scope.workspaceId, scope.teamId);
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ai_jobs WHERE id = ${jobId}::uuid AND creator_id = ${userId}::uuid
          AND workspace_id = ${scope.workspaceId}::uuid AND team_id = ${scope.teamId}::uuid FOR UPDATE
      `;
      if (!locked[0]) throw resourceNotFound();
      const job = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      if (!ACTIVE_JOB_STATUSES.includes(job.status as (typeof ACTIVE_JOB_STATUSES)[number])) return job;

      let inputTokensUsed = job.inputTokensUsed;
      let outputTokensUsed = job.outputTokensUsed;
      if (job.providerAttemptStartedAt && job.providerAttemptUnknown) {
        await recordUnknownAttempt(tx, job);
        inputTokensUsed += job.maxInputTokens;
        outputTokensUsed += job.maxOutputTokens;
      }
      if (!job.quotaSettled) {
        await settleQuota(tx, {
          scopes: quotaScopes(job.creatorId, job.workspaceId), usageDate: job.usageDate,
          providerCallsUsed: job.providerCallsUsed, inputTokensUsed, outputTokensUsed,
          maxInputTokens: job.maxInputTokens, maxOutputTokens: job.maxOutputTokens, attemptLimit: job.attemptLimit,
        });
      }
      const updated = await tx.aiJob.update({
        where: { id: job.id },
        data: {
          status: 'CANCELLED', safeErrorCode: 'AI_CANCELLED', finishedAt: new Date(), leaseToken: null,
          leaseExpiresAt: null, providerAttemptStartedAt: null,
          providerAttemptUnknown: job.providerAttemptStartedAt ? true : job.providerAttemptUnknown,
          stages: json(cancelStages(job.stages, new Date())),
          inputTokensUsed, outputTokensUsed, sequence: { increment: 1 }, quotaSettled: true,
        },
      });
      await appendJobEvent(tx, updated, 'The request was cancelled.');
      return updated;
    }, { timeout: 8_000 });
    this.abortJob(jobId);
    this.wakeWorker();
    return { data: publicJob(result, isRecord(result.checkpoint) ? result.checkpoint as Checkpoint : {}) };
  }

  async retry(userId: string, scope: Scope, jobId: string, requestKey: string) {
    this.requireAvailable();
    const maxInputTokens = this.environment.AI_MAX_INPUT_TOKENS;
    const maxOutputTokens = this.environment.AI_MAX_OUTPUT_TOKENS;
    if (!maxInputTokens || !maxOutputTokens) throw unavailable();
    const requestHash = hashJson({ retryOf: jobId });
    const result = await this.prisma.$transaction(async (tx) => {
      await this.contextService.lockAndCheckAccess(tx, userId, scope.workspaceId, scope.teamId);
      await lockUserQueue(tx, userId);
      const original = await tx.aiJob.findFirst({ where: { id: jobId, creatorId: userId, ...scope } });
      if (!original) throw resourceNotFound();
      const sameKey = await tx.aiJob.findFirst({ where: { creatorId: userId, ...scope, requestKey } });
      if (sameKey) {
        if (sameKey.requestHash !== requestHash) throw idempotencyConflict();
        return { planId: sameKey.planId, jobId: sameKey.id, status: sameKey.status, requestKey };
      }
      if (!['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(original.status)) {
        throw new HttpError(409, 'AI_RETRY_NOT_AVAILABLE', 'Only failed, interrupted, or cancelled jobs can be retried.');
      }
      const plan = await tx.aiPlan.findFirst({ where: { id: original.planId, creatorId: userId }, select: { activeVersionId: true, expiresAt: true } });
      if (!plan || plan.activeVersionId || plan.expiresAt <= new Date()) throw new HttpError(409, 'AI_RETRY_NOT_AVAILABLE', 'This plan can no longer be retried.');
      const active = await tx.aiJob.findFirst({ where: { creatorId: userId, status: { in: [...ACTIVE_JOB_STATUSES] } }, select: { id: true } });
      if (active) throw new HttpError(409, 'AI_JOB_ACTIVE', 'Finish or cancel the current AI plan request before retrying.');
      const attempts = await tx.aiJob.aggregate({ where: { retryRootId: original.retryRootId }, _sum: { providerAttempts: true } });
      const attemptLimit = RETRY_ROOT_LIMIT - (attempts._sum.providerAttempts ?? 0);
      if (attemptLimit <= 0) throw new HttpError(409, 'AI_RETRY_LIMIT_REACHED', 'This request has used its maximum provider attempts.');
      const credential = await tx.userGeminiCredential.findUnique({ where: { userId } });
      if (!credential?.verifiedAt) throw new HttpError(409, 'AI_CREDENTIAL_REQUIRED', 'Configure a verified Gemini credential before retrying.');
      if (!credential.model) throw new HttpError(409, 'AI_MODEL_REQUIRED', 'Select a Gemini model before retrying.');
      const usageDate = businessUsageDate();
      await reserveQuota(tx, { scopes: quotaScopes(userId, scope.workspaceId), usageDate, maxInputTokens, maxOutputTokens, maxAttempts: attemptLimit });
      const retryId = randomUUID();
      const retried = await tx.aiJob.create({
        data: {
          id: retryId, planId: original.planId, workspaceId: scope.workspaceId, teamId: scope.teamId, creatorId: userId,
          credentialRevision: credential.credentialRevision, retryRootId: original.retryRootId, attemptLimit,
          usageDate, maxInputTokens, maxOutputTokens, action: 'RETRY', status: 'QUEUED', requestKey, requestHash,
          input: json(original.input), stages: json(initialStages()), model: credential.model,
          promptVersion: original.promptVersion, expiresAt: original.expiresAt,
        },
      });
      await appendJobEvent(tx, retried, 'The explicit retry was queued.');
      return { planId: retried.planId, jobId: retried.id, status: retried.status, requestKey };
    }, { timeout: 8_000 });
    this.wakeWorker();
    return { data: result };
  }

  private requireAvailable(): void {
    if (!this.environment.AI_ENABLED) throw unavailable();
  }
}

function publicJob(job: AiJob, checkpoint: Checkpoint) {
  return {
    id: job.id, planId: job.planId, status: job.status, currentStage: job.currentStage,
    sequence: job.sequence, stages: job.stages, outputVersionId: job.outputVersionId,
    safeErrorCode: job.safeErrorCode, model: job.model,
    clarificationQuestions: job.status === 'NEEDS_CLARIFICATION' ? checkpoint.understanding?.questions ?? [] : [],
    createdAt: job.createdAt.toISOString(), startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null, expiresAt: job.expiresAt.toISOString(),
  };
}

async function appendJobEvent(tx: Prisma.TransactionClient, job: AiJob, summary: string): Promise<void> {
  await appendRealtimeEvents(tx, [{
    eventType: 'planner.job_changed', workspaceId: job.workspaceId, teamId: job.teamId,
    targetUserId: job.creatorId, resourceId: job.id,
    payload: { jobSequence: job.sequence, status: job.status, stage: job.currentStage, summary },
  }]);
}

async function lockUserQueue(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`WITH queue_lock AS MATERIALIZED (
    SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
  ) SELECT TRUE AS locked FROM queue_lock`;
}

async function recordUnknownAttempt(tx: Prisma.TransactionClient, job: AiJob): Promise<void> {
  for (const scope of quotaScopes(job.creatorId, job.workspaceId)) {
    await tx.$executeRaw`
      UPDATE ai_usage_daily SET
        input_tokens_reserved = GREATEST(0, input_tokens_reserved - ${BigInt(job.maxInputTokens)}),
        input_tokens_used = input_tokens_used + ${BigInt(job.maxInputTokens)},
        output_tokens_reserved = GREATEST(0, output_tokens_reserved - ${BigInt(job.maxOutputTokens)}),
        output_tokens_used = output_tokens_used + ${BigInt(job.maxOutputTokens)},
        updated_at = now()
      WHERE scope_type = ${scope.type}::ai_usage_scope_type AND scope_id = ${scope.id}::uuid AND usage_date = ${job.usageDate}::date
    `;
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function defaultFieldMask(action: Exclude<GenerateRevisionRequest['action'], 'RETRY'>): Array<Exclude<PlannerFieldLock['field'], 'assigneeId'>> {
  switch (action) {
    case 'SIMPLIFY': return ['description', 'checklist'];
    case 'ADD_DETAIL': return ['description', 'completionCriteria', 'checklist'];
    case 'ADJUST_DEADLINE': return ['schedule'];
    case 'REGENERATE': return [];
  }
}

function stripVersionMetadata(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { schemaVersion: _schemaVersion, source: _source, fieldLocks: _fieldLocks, ...content } = value;
  void _schemaVersion;
  void _source;
  void _fieldLocks;
  return content;
}

function readPlannerInput(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const { consentVersion, contextSnapshot, revision: _revision, clonedFromPlanId: _clonedFromPlanId, ...input } = value;
  void _revision;
  void _clonedFromPlanId;
  const parsed = createPlanSchema.safeParse(input);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    consentVersion: typeof consentVersion === 'string' ? consentVersion : '2026-10',
    contextSnapshot: contextSnapshot ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function idempotencyConflict(): HttpError {
  return new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used with different input.');
}

function unavailable(): HttpError {
  return new HttpError(503, 'AI_UNAVAILABLE', 'AI planning is temporarily unavailable. Task management remains available.');
}

function cancelStages(value: unknown, now: Date): PlannerStage[] {
  let stages: PlannerStage[] = Array.isArray(value) ? value as PlannerStage[] : initialStages();
  for (const definition of PLANNER_STAGES) {
    const stage = stages.find((item) => item.key === definition.key);
    if (stage?.status === 'pending' || stage?.status === 'active') {
      stages = stageTransition(stages, definition.key, 'skipped', now, 'Skipped because the request was cancelled.');
    }
  }
  return stages;
}
