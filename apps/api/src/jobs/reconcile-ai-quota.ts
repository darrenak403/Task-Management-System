import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { businessUsageDate } from '../modules/planner/quota.service.js';
import { createLogger } from '../shared/logging/logger.js';
import { loadEnvironment } from '../shared/config/env.js';
import { createPrismaClient } from '../shared/db/prisma.js';

const GLOBAL_SCOPE_ID = '00000000-0000-0000-0000-000000000000';
const OPERATION_LIMITS = { USER: 10, WORKSPACE: 30, GLOBAL: 100 } as const;

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
  const args = parseArgs(process.argv.slice(2));
  if (process.env.CONFIRM_AI_QUOTA_RECONCILIATION !== 'yes') {
    throw new Error('Set CONFIRM_AI_QUOTA_RECONCILIATION=yes after reviewing the restored backup and current quota window.');
  }
  const operator = required(args, 'operator', 120);
  const reason = required(args, 'reason', 1_000);
  if (args.confirm !== 'close-current-window') {
    throw new Error('Pass --confirm close-current-window to record the current Asia/Ho_Chi_Minh AI allowance as fully consumed.');
  }

  const environment = loadEnvironment();
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const logger = createLogger(environment);
  const prisma = createPrismaClient(environment.DATABASE_URL);
  try {
    await prisma.$connect();
    const usageDate = businessUsageDate();
    const result = await prisma.$transaction(async (tx) => {
      const control = await tx.$queryRaw<Array<{ quarantined: boolean }>>`
        SELECT quarantined FROM ai_runtime_control WHERE id = 1 FOR UPDATE
      `;
      if (control[0]?.quarantined !== true) throw new Error('AI restore quarantine is not active.');

      const [jobs, existingScopes, globalUsage] = await Promise.all([
        tx.aiJob.findMany({ where: { usageDate }, select: {
          providerAttempts: true, providerAttemptUnknown: true, providerAttemptStartedAt: true,
          maxInputTokens: true, maxOutputTokens: true, inputTokensUsed: true, outputTokensUsed: true,
        } }),
        tx.aiUsageDaily.findMany({ where: { usageDate }, select: { scopeType: true, scopeId: true } }),
        tx.aiUsageDaily.findUnique({ where: { scopeType_scopeId_usageDate: { scopeType: 'GLOBAL', scopeId: GLOBAL_SCOPE_ID, usageDate } } }),
      ]);
      const unknownProviderCalls = jobs.reduce((total, job) => total + (job.providerAttemptUnknown || job.providerAttemptStartedAt ? 1 : 0), 0);
      // Unknown in-flight calls were already charged at their maximum during the restore pass.
      // Reconciliation consumes the persisted job totals and must not charge that estimate twice.
      const inputTokensUsed = jobs.reduce((total, job) => total + BigInt(job.inputTokensUsed), 0n);
      const outputTokensUsed = jobs.reduce((total, job) => total + BigInt(job.outputTokensUsed), 0n);
      const priorInputTokens = BigInt(globalUsage?.inputTokensUsed ?? 0n) + BigInt(globalUsage?.inputTokensReserved ?? 0n);
      const priorOutputTokens = BigInt(globalUsage?.outputTokensUsed ?? 0n) + BigInt(globalUsage?.outputTokensReserved ?? 0n);
      const auditInputTokens = inputTokensUsed > priorInputTokens ? inputTokensUsed : priorInputTokens;
      const auditOutputTokens = outputTokensUsed > priorOutputTokens ? outputTokensUsed : priorOutputTokens;

      // Close the whole current business-day window. This makes restored counters incapable of reopening quota.
      for (const scope of existingScopes) {
        await tx.aiUsageDaily.update({
          where: { scopeType_scopeId_usageDate: { ...scope, usageDate } },
          data: {
            operationsReserved: 0,
            operationsUsed: OPERATION_LIMITS[scope.scopeType],
            callsReserved: 0,
            callsUsed: 400,
            inputTokensReserved: 0n,
            outputTokensReserved: 0n,
          },
        });
      }
      await tx.aiUsageDaily.upsert({
        where: { scopeType_scopeId_usageDate: { scopeType: 'GLOBAL', scopeId: GLOBAL_SCOPE_ID, usageDate } },
        create: {
          scopeType: 'GLOBAL', scopeId: GLOBAL_SCOPE_ID, usageDate,
          operationsReserved: 0, operationsUsed: 100, callsReserved: 0, callsUsed: 400,
          inputTokensReserved: 0n, inputTokensUsed: auditInputTokens,
          outputTokensReserved: 0n, outputTokensUsed: auditOutputTokens,
        },
        update: {
          operationsReserved: 0, operationsUsed: 100, callsReserved: 0, callsUsed: 400,
          inputTokensReserved: 0n, inputTokensUsed: auditInputTokens,
          outputTokensReserved: 0n, outputTokensUsed: auditOutputTokens,
        },
      });
      const audit = await tx.aiQuotaReconciliation.create({
        data: {
          usageDate, operationsUsed: 100, providerCallsUsed: 400,
          inputTokensUsed: auditInputTokens, outputTokensUsed: auditOutputTokens,
          unknownProviderCalls, enabledAfterReview: true, operator, reason,
        },
      });
      await tx.aiRuntimeControl.update({
        where: { id: 1 }, data: { quarantined: false, quarantineReason: null },
      });
      return { auditId: audit.id, usageDate: usageDate.toISOString().slice(0, 10), unknownProviderCalls };
    }, { timeout: 20_000, maxWait: 5_000 });
    logger.info(result, 'AI restore quota reconciliation recorded; current daily allowance remains exhausted until the next business date.');
  } finally {
    await prisma.$disconnect();
    await logger.flush();
  }
}

function parseArgs(values: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith('--')) throw new Error('Use named options: --operator, --reason, --confirm.');
    const value = values[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}.`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function required(args: Record<string, string>, key: string, maxLength: number): string {
  const value = args[key]?.trim();
  if (!value || value.length > maxLength) throw new Error(`--${key} is required and must be at most ${maxLength} characters.`);
  return value;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'AI quota reconciliation failed.'}\n`);
  process.exitCode = 1;
});
