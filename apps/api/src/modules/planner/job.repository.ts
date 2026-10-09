import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, AiJob } from '../../generated/prisma/client.js';
import { appendRealtimeEvents } from '../realtime/outbox.js';
import type { PlannerStageKey, PlannerStageStatus } from './stage-catalog.js';
import { activateStage, stageTransition } from './stage-catalog.js';
import { assertAiRuntimeAvailable, quotaScopes, recordProviderAttemptStart, recordProviderTokenUsage, settleQuota } from './quota.service.js';
import type { QuotaScope } from './quota.service.js';
import type { PlanOutput } from './planner.schemas.js';
import type { PersistedCandidate, PlannerFieldLock } from './version.schemas.js';
import type { PlannerContextService } from './context.service.js';

const MAX_PROVIDER_ATTEMPTS = 4;
const LEASE_MS = 30_000;
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export class LeaseLostError extends Error {
  constructor() {
    super('The AI job lease is no longer current.');
    this.name = 'LeaseLostError';
  }
}

export class ProviderAttemptLimitError extends Error {
  constructor() {
    super('The AI job has used its provider attempt limit.');
    this.name = 'ProviderAttemptLimitError';
  }
}

export class PlannerAccessRevokedError extends Error {
  constructor(readonly reason: 'ACCESS_REVOKED' | 'AI_CREDENTIAL_CHANGED') {
    super(reason);
    this.name = 'PlannerAccessRevokedError';
  }
}

export class PlannerPlanError extends Error {
  constructor(readonly code: 'AI_PLAN_EXPIRED' | 'AI_PLAN_NOT_EDITABLE' | 'AI_VERSION_STALE') {
    super(code);
    this.name = 'PlannerPlanError';
  }
}

export type JobEventSummary = { status: AiJob['status']; currentStage: string | null; sequence: number };

export class AiJobRepository {
  constructor(private readonly prisma: PrismaClient, private readonly contextService: PlannerContextService) {}

  async claimNext(): Promise<{ job: AiJob; leaseToken: string } | null> {
    const leaseToken = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const selected = await tx.$queryRaw<Array<{ id: string; started_at: Date | null; current_stage: string | null; stages: unknown }>>`
        SELECT id, started_at, current_stage, stages FROM ai_jobs
        WHERE status = 'QUEUED'
          AND EXISTS (SELECT 1 FROM ai_runtime_control WHERE id = 1 AND quarantined = false)
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED LIMIT 1
      `;
      const candidate = selected[0];
      if (!candidate) return null;
      const now = new Date();
      const currentStage = candidate.current_stage ?? 'understanding_goal';
      const stages = activateStage(candidate.stages, currentStage as PlannerStageKey, now);
      const changed = await tx.aiJob.updateMany({
        where: { id: candidate.id, status: 'QUEUED' },
        data: {
          status: 'RUNNING', leaseToken, leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          attempt: { increment: 1 }, startedAt: candidate.started_at ?? now,
          processingStartedAt: now,
          currentStage, stages: json(stages), sequence: { increment: 1 },
        },
      });
      if (changed.count !== 1) return null;
      const job = await tx.aiJob.findUniqueOrThrow({ where: { id: candidate.id } });
      await appendJobEvent(tx, job, 'Work is running.');
      return { job, leaseToken };
    }, { timeout: 8_000 });
  }

  async renewLease(jobId: string, leaseToken: string): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.aiJob.updateMany({
      where: { id: jobId, status: 'RUNNING', leaseToken, leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
    });
    return result.count === 1;
  }

  async setStage(
    jobId: string,
    leaseToken: string,
    input: { key: PlannerStageKey; status: PlannerStageStatus; summary?: string; checkpoint?: unknown },
  ): Promise<AiJob> {
    return this.prisma.$transaction(async (tx) => {
      const job = await requireLease(tx, jobId, leaseToken);
      const existingStage = Array.isArray(job.stages)
        ? (job.stages as Array<{ key?: string; status?: PlannerStageStatus }>).find((stage) => stage.key === input.key)
        : undefined;
      if (existingStage?.status === input.status) return job;
      const stages = stageTransition(job.stages, input.key, input.status, new Date(), input.summary ?? null);
      const changed = await tx.aiJob.updateMany({
        where: { id: jobId, status: 'RUNNING', leaseToken, leaseExpiresAt: { gt: new Date() } },
        data: {
          stages: json(stages), currentStage: input.key, sequence: { increment: 1 },
          ...(input.checkpoint !== undefined ? { checkpoint: json(input.checkpoint) } : {}),
        },
      });
      if (changed.count !== 1) throw new LeaseLostError();
      const updated = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      await appendJobEvent(tx, updated, input.summary ?? stageSummary(input.status));
      return updated;
    }, { timeout: 8_000 });
  }

  async startProviderAttempt(jobId: string, leaseToken: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await assertAiRuntimeAvailable(tx);
      const job = await requireLease(tx, jobId, leaseToken);
      const rootUsage = await tx.aiJob.aggregate({ where: { retryRootId: job.retryRootId }, _sum: { providerAttempts: true } });
      if (job.providerAttempts >= job.attemptLimit || (rootUsage._sum.providerAttempts ?? 0) >= MAX_PROVIDER_ATTEMPTS) {
        throw new ProviderAttemptLimitError();
      }
      const changed = await tx.aiJob.updateMany({
        where: { id: jobId, status: 'RUNNING', leaseToken, leaseExpiresAt: { gt: new Date() }, providerAttempts: { lt: job.attemptLimit } },
        data: {
          providerAttempts: { increment: 1 }, providerCallsUsed: { increment: 1 },
          providerAttemptStartedAt: new Date(), providerAttemptUnknown: true,
        },
      });
      if (changed.count !== 1) throw new LeaseLostError();
      await recordProviderAttemptStart(tx, usageScopes(job), job.usageDate);
    }, { timeout: 8_000 });
  }

  async recordProviderResult(
    jobId: string,
    leaseToken: string,
    result: { checkpoint?: unknown; inputTokens: number; outputTokens: number },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockLease(tx, jobId, leaseToken);
      const job = await requireLease(tx, jobId, leaseToken);
      await recordProviderTokenUsage(tx, usageScopes(job), job.usageDate, result.inputTokens, result.outputTokens);
      const changed = await tx.aiJob.updateMany({
        where: { id: jobId, status: 'RUNNING', leaseToken, leaseExpiresAt: { gt: new Date() }, providerAttemptStartedAt: { not: null } },
        data: {
          providerAttemptStartedAt: null, providerAttemptUnknown: false,
          inputTokensUsed: { increment: result.inputTokens }, outputTokensUsed: { increment: result.outputTokens },
          ...(result.checkpoint !== undefined ? { checkpoint: json(result.checkpoint) } : {}),
        },
      });
      if (changed.count !== 1) throw new LeaseLostError();
    }, { timeout: 8_000 });
  }

  async finishProviderFailure(
    jobId: string,
    leaseToken: string,
    input: { code: string; unknown: boolean },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockLease(tx, jobId, leaseToken);
      const job = await requireLease(tx, jobId, leaseToken);
      const hasAttempt = job.providerAttemptStartedAt !== null;
      const inputTokensUsed = job.inputTokensUsed + (hasAttempt ? job.maxInputTokens : 0);
      const outputTokensUsed = job.outputTokensUsed + (hasAttempt ? job.maxOutputTokens : 0);
      if (hasAttempt) await recordProviderTokenUsage(tx, usageScopes(job), job.usageDate, job.maxInputTokens, job.maxOutputTokens);
      const now = new Date();
      const stages = stageTransition(job.stages, safeStageKey(job.currentStage), 'failed', now, safeSummary(input.code));
      const status = input.unknown ? 'INTERRUPTED' : 'FAILED';
      const changed = await tx.aiJob.updateMany({
        where: { id: jobId, status: 'RUNNING', leaseToken, leaseExpiresAt: { gt: now }, quotaSettled: false },
        data: {
          status, safeErrorCode: input.code, stages: json(stages), finishedAt: now,
          leaseToken: null, leaseExpiresAt: null, providerAttemptStartedAt: null,
          providerAttemptUnknown: input.unknown, inputTokensUsed, outputTokensUsed,
          sequence: { increment: 1 }, quotaSettled: true,
        },
      });
      if (changed.count !== 1) throw new LeaseLostError();
      await settleQuota(tx, quotaSettlement({ ...job, inputTokensUsed, outputTokensUsed }));
      const updated = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      await appendJobEvent(tx, updated, safeSummary(input.code));
    }, { timeout: 8_000 });
  }

  async waitForClarification(jobId: string, leaseToken: string, questions: string[], checkpoint: unknown): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const job = await requireLease(tx, jobId, leaseToken);
      const stages = stageTransition(job.stages, 'understanding_goal', 'active', new Date(), 'A clarification is needed.');
      const changed = await tx.aiJob.updateMany({
        where: { id: jobId, status: 'RUNNING', leaseToken, leaseExpiresAt: { gt: new Date() } },
        data: {
          status: 'NEEDS_CLARIFICATION', stages: json(stages), checkpoint: json(checkpoint), currentStage: 'understanding_goal',
          sequence: { increment: 1 }, leaseToken: null, leaseExpiresAt: null, processingStartedAt: null,
        },
      });
      if (changed.count !== 1) throw new LeaseLostError();
      const updated = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      await appendJobEvent(tx, updated, `Please answer ${questions.length} clarification question${questions.length === 1 ? '' : 's'}.`);
    }, { timeout: 8_000 });
  }

  async complete(
    jobId: string,
    leaseToken: string,
    draft: PlanOutput,
    candidate?: PersistedCandidate,
    assigneeSuggestions: ReadonlyMap<string, string> = new Map(),
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const scope = await tx.aiJob.findFirst({ where: { id: jobId }, select: { creatorId: true, workspaceId: true, teamId: true, planId: true } });
      if (!scope) throw new LeaseLostError();
      await this.contextService.lockAndCheckAccess(tx, scope.creatorId, scope.workspaceId, scope.teamId);
      const lockedPlan = await tx.$queryRaw<Array<{ id: string; status: string; expires_at: Date; active_version_id: string | null }>>`
        SELECT id, status, expires_at, active_version_id FROM ai_plans WHERE id = ${scope.planId}::uuid AND creator_id = ${scope.creatorId}::uuid FOR UPDATE
      `;
      const lockedJob = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ai_jobs WHERE id = ${jobId}::uuid AND lease_token = ${leaseToken}::uuid AND status = 'RUNNING' FOR UPDATE
      `;
      if (!lockedPlan[0] || !lockedJob[0]) throw new LeaseLostError();
      if (lockedPlan[0].expires_at <= new Date()) throw new PlannerPlanError('AI_PLAN_EXPIRED');
      if (lockedPlan[0].status !== 'DRAFT') throw new PlannerPlanError('AI_PLAN_NOT_EDITABLE');
      if (candidate && lockedPlan[0].active_version_id !== candidate.baseVersionId) throw new PlannerPlanError('AI_VERSION_STALE');
      if (!candidate && lockedPlan[0].active_version_id !== null) throw new PlannerPlanError('AI_VERSION_STALE');
      const credentials = await tx.$queryRaw<Array<{ credential_revision: string }>>`
        SELECT credential_revision FROM user_gemini_credentials WHERE user_id = ${scope.creatorId}::uuid FOR SHARE
      `;
      if (credentials[0]?.credential_revision !== (await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } })).credentialRevision) {
        throw new PlannerAccessRevokedError('AI_CREDENTIAL_CHANGED');
      }
      const job = await requireLease(tx, jobId, leaseToken);
      const plan = await tx.aiPlan.findUniqueOrThrow({ where: { id: job.planId } });
      const latestVersion = await tx.aiPlanVersion.aggregate({ where: { planId: plan.id }, _max: { ordinal: true } });
      const stages = stageTransition(job.stages, 'preparing_plan', 'completed', new Date(), `${draft.items.length} draft items were validated and saved.`);
      const source = candidate?.action === 'ADJUST_DEADLINE' ? 'ADJUSTED' : candidate ? 'REGENERATED' : 'GENERATED';
      const lockOverrides = new Set(candidate?.overrideLocks.map((lock) => `${lock.itemId}:${lock.field}`) ?? []);
      const fieldLocks: PlannerFieldLock[] = (candidate?.fieldLocks ?? []).filter((lock) => !lockOverrides.has(`${lock.itemId}:${lock.field}`));
      const baseItems = new Map(candidate?.baseDraft.items.map((item) => [item.id, item]) ?? []);
      const persistedDraft = {
        ...draft,
        schemaVersion: 1,
        source,
        fieldLocks,
        items: draft.items.map((item, index) => {
          const base = baseItems.get(item.id);
          return {
            ...item,
            selected: base?.selected ?? true,
            assigneeId: base?.assigneeId ?? assigneeSuggestions.get(item.id) ?? null,
            position: base?.position ?? index,
          };
        }),
      };
      const contentHash = (await import('node:crypto')).createHash('sha256').update(JSON.stringify(persistedDraft)).digest('hex');
      const version = await tx.aiPlanVersion.create({
        data: {
          planId: plan.id, ordinal: (latestVersion._max.ordinal ?? 0) + 1,
          parentVersionId: candidate?.baseVersionId ?? plan.activeVersionId,
          baseVersionId: candidate?.baseVersionId ?? plan.activeVersionId,
          source, schemaVersion: 1,
          draft: json(persistedDraft), inputSnapshot: json(job.input), contextSnapshot: extractContext(job.input),
          fieldLocks: json(fieldLocks), contentHash,
        },
      });
      const now = new Date();
      if (!candidate) await tx.aiPlan.update({ where: { id: plan.id }, data: { activeVersionId: version.id } });
      const changed = await tx.aiJob.updateMany({
        where: { id: jobId, status: 'RUNNING', leaseToken, leaseExpiresAt: { gt: now }, quotaSettled: false },
        data: {
          status: 'SUCCEEDED', stages: json(stages), currentStage: 'preparing_plan', outputVersionId: version.id,
          finishedAt: now, leaseToken: null, leaseExpiresAt: null, sequence: { increment: 1 }, quotaSettled: true,
        },
      });
      if (changed.count !== 1) throw new LeaseLostError();
      await settleQuota(tx, quotaSettlement(job));
      const updated = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      await appendJobEvent(tx, updated, candidate ? 'A revision candidate is ready for review.' : `Draft ready with ${draft.items.length} items.`);
      await appendRealtimeEvents(tx, [{
        eventType: 'planner.plan_changed', workspaceId: job.workspaceId, teamId: job.teamId,
        targetUserId: job.creatorId, resourceId: plan.id,
        payload: { versionId: version.id, versionOrdinal: version.ordinal, summary: candidate ? 'A plan revision candidate is ready.' : 'The first plan draft is ready.' },
      }]);
    }, { timeout: 8_000 });
  }

  async fail(jobId: string, leaseToken: string, code: string, status: 'FAILED' | 'INTERRUPTED' | 'CANCELLED'): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockLease(tx, jobId, leaseToken);
      const job = await requireLease(tx, jobId, leaseToken);
      const now = new Date();
      const hasUnknownAttempt = job.providerAttemptStartedAt !== null;
      const inputTokensUsed = job.inputTokensUsed + (hasUnknownAttempt ? job.maxInputTokens : 0);
      const outputTokensUsed = job.outputTokensUsed + (hasUnknownAttempt ? job.maxOutputTokens : 0);
      if (hasUnknownAttempt) await recordProviderTokenUsage(tx, usageScopes(job), job.usageDate, job.maxInputTokens, job.maxOutputTokens);
      const finalStatus = hasUnknownAttempt ? 'INTERRUPTED' : status;
      const finalCode = hasUnknownAttempt ? 'AI_INTERRUPTED' : code;
      const stages = stageTransition(job.stages, safeStageKey(job.currentStage), 'failed', now, safeSummary(finalCode));
      const changed = await tx.aiJob.updateMany({
        where: { id: jobId, status: 'RUNNING', leaseToken, leaseExpiresAt: { gt: now }, quotaSettled: false },
        data: {
          status: finalStatus, safeErrorCode: finalCode, stages: json(stages), finishedAt: now,
          leaseToken: null, leaseExpiresAt: null, providerAttemptStartedAt: null,
          providerAttemptUnknown: hasUnknownAttempt, inputTokensUsed, outputTokensUsed,
          sequence: { increment: 1 }, quotaSettled: true,
      },
      });
      if (changed.count !== 1) throw new LeaseLostError();
      await settleQuota(tx, quotaSettlement({ ...job, inputTokensUsed, outputTokensUsed }));
      const updated = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      await appendJobEvent(tx, updated, safeSummary(finalCode));
    }, { timeout: 8_000 });
  }

  async recoverExpired(): Promise<void> {
    const candidates = await this.prisma.aiJob.findMany({
      where: { status: 'RUNNING', leaseExpiresAt: { lte: new Date() } },
      select: { id: true }, orderBy: { leaseExpiresAt: 'asc' }, take: 100,
    });
    for (const candidate of candidates) await this.recoverOne(candidate.id);
  }

  async nextLeaseExpiry(): Promise<Date | null> {
    const job = await this.prisma.aiJob.findFirst({
      where: { status: 'RUNNING', leaseExpiresAt: { not: null } },
      orderBy: { leaseExpiresAt: 'asc' }, select: { leaseExpiresAt: true },
    });
    return job?.leaseExpiresAt ?? null;
  }

  async getOwnedJob(userId: string, workspaceId: string, teamId: string, jobId: string): Promise<AiJob | null> {
    return this.prisma.aiJob.findFirst({ where: { id: jobId, creatorId: userId, workspaceId, teamId } });
  }

  private async recoverOne(jobId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ai_jobs WHERE id = ${jobId}::uuid AND status = 'RUNNING'
          AND lease_expires_at <= now() FOR UPDATE SKIP LOCKED
      `;
      if (!locked[0]) return;
      const job = await tx.aiJob.findFirst({ where: { id: jobId, status: 'RUNNING', leaseExpiresAt: { lte: new Date() } } });
      if (!job) return;
      const now = new Date();
      if (job.providerAttemptStartedAt) {
        if (job.providerAttemptUnknown) {
          await recordProviderTokenUsage(tx, usageScopes(job), job.usageDate, job.maxInputTokens, job.maxOutputTokens);
        }
        const inputTokensUsed = job.inputTokensUsed + (job.providerAttemptUnknown ? job.maxInputTokens : 0);
        const outputTokensUsed = job.outputTokensUsed + (job.providerAttemptUnknown ? job.maxOutputTokens : 0);
        await settleQuota(tx, quotaSettlement({ ...job, inputTokensUsed, outputTokensUsed }));
        const stages = stageTransition(job.stages, safeStageKey(job.currentStage), 'failed', now, 'The request outcome is unknown; it was not retried.');
        await tx.aiJob.update({
          where: { id: job.id },
          data: {
            status: 'INTERRUPTED', safeErrorCode: 'AI_INTERRUPTED', stages: json(stages), finishedAt: now,
            sequence: { increment: 1 }, leaseToken: null, leaseExpiresAt: null, quotaSettled: true,
            inputTokensUsed, outputTokensUsed,
          },
        });
        const updated = await tx.aiJob.findUniqueOrThrow({ where: { id: job.id } });
        await appendJobEvent(tx, updated, 'The provider result is unknown. Retry requires a new user request.');
        return;
      }

      const updated = await tx.aiJob.update({
        where: { id: job.id },
        data: { status: 'QUEUED', leaseToken: null, leaseExpiresAt: null, sequence: { increment: 1 } },
      });
      await appendJobEvent(tx, updated, 'A saved stage will resume.');
    }, { timeout: 8_000 });
  }
}

async function requireLease(tx: Prisma.TransactionClient, jobId: string, leaseToken: string): Promise<AiJob> {
  const job = await tx.aiJob.findFirst({
    where: { id: jobId, status: 'RUNNING', leaseToken, leaseExpiresAt: { gt: new Date() } },
  });
  if (!job) throw new LeaseLostError();
  return job;
}

async function lockLease(tx: Prisma.TransactionClient, jobId: string, leaseToken: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ai_jobs WHERE id = ${jobId}::uuid AND status = 'RUNNING'
      AND lease_token = ${leaseToken}::uuid AND lease_expires_at > now() FOR UPDATE
  `;
  if (!rows[0]) throw new LeaseLostError();
}

function usageScopes(job: Pick<AiJob, 'creatorId' | 'workspaceId'>): QuotaScope[] {
  return quotaScopes(job.creatorId, job.workspaceId);
}

function quotaSettlement(job: Pick<AiJob, 'creatorId' | 'workspaceId' | 'usageDate' | 'providerCallsUsed' | 'inputTokensUsed' | 'outputTokensUsed' | 'maxInputTokens' | 'maxOutputTokens' | 'attemptLimit'>) {
  return {
    scopes: quotaScopes(job.creatorId, job.workspaceId), usageDate: job.usageDate,
    providerCallsUsed: job.providerCallsUsed, inputTokensUsed: job.inputTokensUsed,
    outputTokensUsed: job.outputTokensUsed, maxInputTokens: job.maxInputTokens, maxOutputTokens: job.maxOutputTokens,
    attemptLimit: job.attemptLimit,
  };
}

function extractContext(input: Prisma.JsonValue): Prisma.InputJsonValue {
  if (typeof input === 'object' && input !== null && 'contextSnapshot' in input) {
    return json(input.contextSnapshot);
  }
  return json({ capturedAt: new Date(0).toISOString(), tasks: [], members: [] });
}

async function appendJobEvent(tx: Prisma.TransactionClient, job: AiJob, summary: string): Promise<void> {
  await appendRealtimeEvents(tx, [{
    eventType: 'planner.job_changed', workspaceId: job.workspaceId, teamId: job.teamId,
    targetUserId: job.creatorId, resourceId: job.id,
    payload: { jobSequence: job.sequence, status: job.status, stage: job.currentStage, summary },
  }]);
}

function safeStageKey(value: string | null): PlannerStageKey {
  const keys: PlannerStageKey[] = ['understanding_goal', 'breaking_down_work', 'prioritizing_tasks', 'planning_timeline', 'preparing_plan'];
  return keys.includes(value as PlannerStageKey) ? value as PlannerStageKey : 'understanding_goal';
}

function stageSummary(status: PlannerStageStatus): string {
  return status === 'active' ? 'Stage started.' : status === 'completed' ? 'Stage completed.' : status === 'failed' ? 'Stage failed.' : 'Stage updated.';
}

function safeSummary(code: string): string {
  const summaries: Record<string, string> = {
    AI_TIMEOUT: 'The request timed out and was not replayed.',
    AI_RATE_LIMITED: 'The provider rate limit was reached.',
    AI_OUTPUT_INVALID: 'The provider output did not pass validation.',
    AI_REFUSED: 'The provider could not process this request.',
    AI_PROVIDER_UNAVAILABLE: 'The AI provider is temporarily unavailable.',
    AI_CREDENTIAL_CHANGED: 'The configured credential changed.',
    ACCESS_REVOKED: 'Access to this team was removed.',
    AI_INTERRUPTED: 'The request outcome is unknown and was not replayed.',
    AI_CANCELLED: 'The request was cancelled.',
  };
  return summaries[code] ?? 'The request could not be completed.';
}
