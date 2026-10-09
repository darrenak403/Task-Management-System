import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { Prisma } from '../generated/prisma/client.js';
import { quotaScopes, recordProviderTokenUsage, settleQuota } from '../modules/planner/quota.service.js';
import { PLANNER_STAGES, type PlannerStage } from '../modules/planner/stage-catalog.js';
import { rotateRealtimeEpoch } from '../modules/realtime/clock.js';
import { createLogger } from '../shared/logging/logger.js';
import { loadEnvironment } from '../shared/config/env.js';
import { createPrismaClient } from '../shared/db/prisma.js';

const BATCH_SIZE = 50;
const ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'NEEDS_CLARIFICATION'] as const;
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
  if (process.env.CONFIRM_BACKEND_RESTORE !== 'yes') {
    throw new Error('Set CONFIRM_BACKEND_RESTORE=yes after stopping API traffic and restoring the database.');
  }
  const environment = loadEnvironment();
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const logger = createLogger(environment);
  const prisma = createPrismaClient(environment.DATABASE_URL);
  try {
    await prisma.$connect();
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: number }>>`
        UPDATE ai_runtime_control
        SET quarantined = true, quarantine_reason = 'RESTORE_REQUIRES_RECONCILIATION', updated_at = now()
        WHERE id = 1 RETURNING id
      `;
      if (!rows[0]) throw new Error('AI runtime-control singleton is missing; apply all migrations first.');
    }, { timeout: 8_000 });

    let cancelledJobs = 0;
    let unknownProviderCalls = 0;
    while (true) {
      const result = await prisma.$transaction(async (tx) => {
        const jobs = await tx.aiJob.findMany({
          where: { status: { in: [...ACTIVE_STATUSES] } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: BATCH_SIZE,
        });
        const now = new Date();
        let cancelled = 0;
        let unknown = 0;
        for (const job of jobs) {
          const hasUnknownAttempt = job.providerAttemptStartedAt !== null && job.providerAttemptUnknown;
          let inputTokensUsed = job.inputTokensUsed;
          let outputTokensUsed = job.outputTokensUsed;
          if (!job.quotaSettled) {
            if (hasUnknownAttempt) {
              await recordProviderTokenUsage(tx, quotaScopes(job.creatorId, job.workspaceId), job.usageDate, job.maxInputTokens, job.maxOutputTokens);
              inputTokensUsed += job.maxInputTokens;
              outputTokensUsed += job.maxOutputTokens;
              unknown += 1;
            }
            await settleQuota(tx, {
              scopes: quotaScopes(job.creatorId, job.workspaceId), usageDate: job.usageDate,
              providerCallsUsed: job.providerCallsUsed, inputTokensUsed, outputTokensUsed,
              maxInputTokens: job.maxInputTokens, maxOutputTokens: job.maxOutputTokens, attemptLimit: job.attemptLimit,
            });
          }
          const changed = await tx.aiJob.updateMany({
            where: { id: job.id, status: { in: [...ACTIVE_STATUSES] } },
            data: {
              status: 'CANCELLED', safeErrorCode: 'RESTORE_INTERRUPTED', finishedAt: now,
              leaseToken: null, leaseExpiresAt: null, providerAttemptStartedAt: null,
              processingStartedAt: null,
              providerAttemptUnknown: hasUnknownAttempt || job.providerAttemptUnknown,
              inputTokensUsed, outputTokensUsed, quotaSettled: true,
              currentStage: job.currentStage ?? 'understanding_goal',
              stages: json(restoredStages(job.stages, now)), sequence: { increment: 1 },
            },
          });
          cancelled += changed.count;
        }
        return { count: cancelled, unknown };
      }, { timeout: 20_000, maxWait: 5_000 });
      cancelledJobs += result.count;
      unknownProviderCalls += result.unknown;
      if (result.count === 0) break;
    }

    const epoch = await rotateRealtimeEpoch(prisma);
    logger.info({ cancelledJobs, unknownProviderCalls, realtimeEventsCleared: epoch.eventsCleared, sessionsRevoked: epoch.sessionsRevoked },
      'Database restore is isolated; AI remains quarantined until quota reconciliation.');
  } finally {
    await prisma.$disconnect();
    await logger.flush();
  }
}

function restoredStages(value: unknown, now: Date): PlannerStage[] {
  const source = Array.isArray(value) ? value.filter(isRecord) : [];
  return PLANNER_STAGES.map(({ key, label }) => {
    const current = source.find((stage) => stage.key === key);
    const status = current?.status;
    if (current && (status === 'completed' || status === 'failed' || status === 'skipped')) {
      return {
        key, label, status,
        startedAt: typeof current.startedAt === 'string' ? current.startedAt : null,
        completedAt: typeof current.completedAt === 'string' ? current.completedAt : now.toISOString(),
        summary: typeof current.summary === 'string' ? current.summary : null,
      };
    }
    const isActive = status === 'active';
    return {
      key, label, status: isActive ? 'failed' : 'skipped',
      startedAt: typeof current?.startedAt === 'string' ? current.startedAt : isActive ? now.toISOString() : null,
      completedAt: now.toISOString(),
      summary: 'Interrupted by database restore; the request was not replayed.',
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

void main().catch(() => {
  process.stderr.write('Post-restore backend isolation failed; keep API traffic stopped and AI disabled.\n');
  process.exitCode = 1;
});
