import { Prisma, type PrismaClient, type AiJob } from '../../generated/prisma/client.js';
import { appendRealtimeEvents } from '../realtime/outbox.js';
import { initialStages, PLANNER_STAGES, stageTransition, type PlannerStage, type PlannerStageKey } from './stage-catalog.js';
import { quotaScopes, recordProviderTokenUsage, settleQuota } from './quota.service.js';

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const PURGED_PAYLOAD = json({ purged: true });

export type AiRetentionResult = { purged: boolean; jobsCancelled: number; jobsInterrupted: number };

/** One-shot, idempotent cleanup. The caller schedules this command once per day. */
export class AiRetentionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async purgeOneExpiredPlan(): Promise<AiRetentionResult> {
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ai_plans
        WHERE expires_at <= now() AND purged_at IS NULL
        ORDER BY expires_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const candidate = candidates[0];
      if (!candidate) return { purged: false, jobsCancelled: 0, jobsInterrupted: 0 };
      const plan = await tx.aiPlan.findUniqueOrThrow({ where: { id: candidate.id }, select: { status: true } });

      const lockedJobs = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ai_jobs WHERE plan_id = ${candidate.id}::uuid ORDER BY id ASC FOR UPDATE
      `;
      const jobs = await tx.aiJob.findMany({ where: { id: { in: lockedJobs.map((job) => job.id) } }, orderBy: { id: 'asc' } });
      let jobsCancelled = 0;
      let jobsInterrupted = 0;
      const now = new Date();

      for (const job of jobs) {
        if (isActive(job)) {
          const hasUnknownProviderOutcome = job.providerAttemptStartedAt !== null;
          const inputTokensUsed = job.inputTokensUsed + (hasUnknownProviderOutcome ? job.maxInputTokens : 0);
          const outputTokensUsed = job.outputTokensUsed + (hasUnknownProviderOutcome ? job.maxOutputTokens : 0);
          if (hasUnknownProviderOutcome) {
            await recordProviderTokenUsage(
              tx, quotaScopes(job.creatorId, job.workspaceId), job.usageDate,
              job.maxInputTokens, job.maxOutputTokens,
            );
          }
          if (!job.quotaSettled) {
            await settleQuota(tx, {
              scopes: quotaScopes(job.creatorId, job.workspaceId), usageDate: job.usageDate,
              providerCallsUsed: job.providerCallsUsed, inputTokensUsed, outputTokensUsed,
              maxInputTokens: job.maxInputTokens, maxOutputTokens: job.maxOutputTokens,
              attemptLimit: job.attemptLimit,
            });
          }

          const status = hasUnknownProviderOutcome ? 'INTERRUPTED' : 'CANCELLED';
          const safeCode = hasUnknownProviderOutcome ? 'AI_INTERRUPTED' : 'AI_RETENTION_EXPIRED';
          const stages = finishStages(job, hasUnknownProviderOutcome ? 'failed' : 'skipped', now,
            hasUnknownProviderOutcome ? 'The request outcome is unknown; it was not retried.' : 'The plan expired before this stage ran.');
          const updated = await tx.aiJob.update({
            where: { id: job.id },
            data: {
              status, safeErrorCode: safeCode, stages: json(stages), finishedAt: now,
              leaseToken: null, leaseExpiresAt: null, providerAttemptStartedAt: null,
              providerAttemptUnknown: hasUnknownProviderOutcome, inputTokensUsed, outputTokensUsed,
              sequence: { increment: 1 }, quotaSettled: true,
            },
          });
          await appendJobEvent(tx, updated, hasUnknownProviderOutcome
            ? 'The provider outcome is unknown; this expired plan will not be retried.'
            : 'The plan expired and the queued request was cancelled.');
          if (hasUnknownProviderOutcome) jobsInterrupted += 1;
          else jobsCancelled += 1;
        }

        await tx.aiJob.update({
          where: { id: job.id },
          data: { input: PURGED_PAYLOAD, checkpoint: Prisma.JsonNull },
        });
      }

      await tx.aiPlanVersion.updateMany({
        where: { planId: candidate.id },
        data: {
          draft: PURGED_PAYLOAD,
          inputSnapshot: PURGED_PAYLOAD,
          contextSnapshot: Prisma.JsonNull,
        },
      });
      await tx.aiPlan.update({
        where: { id: candidate.id },
        data: {
          ...(plan.status === 'DRAFT' ? { status: 'EXPIRED' as const } : {}),
          purgedAt: now,
        },
      });
      return { purged: true, jobsCancelled, jobsInterrupted };
    }, { timeout: 15_000, maxWait: 5_000 });
  }
}

function isActive(job: AiJob): boolean {
  return job.status === 'QUEUED' || job.status === 'RUNNING' || job.status === 'NEEDS_CLARIFICATION';
}

function finishStages(
  job: AiJob,
  activeStatus: 'failed' | 'skipped',
  now: Date,
  summary: string,
) {
  const currentStage = PLANNER_STAGES.some((stage) => stage.key === job.currentStage)
    ? job.currentStage as PlannerStageKey
    : null;
  let stages: PlannerStage[] = Array.isArray(job.stages) ? job.stages as PlannerStage[] : initialStages();
  for (const stage of PLANNER_STAGES) {
    const current = stages.find((item) => item.key === stage.key);
    if (!current || (current.status !== 'pending' && current.status !== 'active')) continue;
    const status = current.status;
    const terminal = status === 'active' && currentStage === stage.key ? activeStatus : 'skipped';
    stages = stageTransition(stages, stage.key, terminal, now, terminal === activeStatus ? summary : 'Skipped after plan expiry.');
  }
  return stages;
}

async function appendJobEvent(tx: Prisma.TransactionClient, job: AiJob, summary: string): Promise<void> {
  await appendRealtimeEvents(tx, [{
    eventType: 'planner.job_changed', workspaceId: job.workspaceId, teamId: job.teamId,
    targetUserId: job.creatorId, resourceId: job.id,
    payload: { jobSequence: job.sequence, status: job.status, stage: job.currentStage, summary },
  }]);
}
