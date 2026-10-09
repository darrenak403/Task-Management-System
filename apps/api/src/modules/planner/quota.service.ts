import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../shared/http/error-handler.js';

const GLOBAL_SCOPE_ID = '00000000-0000-0000-0000-000000000000';
const MAX_PROVIDER_ATTEMPTS = 4;
const limits = { USER: 10, WORKSPACE: 30, GLOBAL: 100 } as const;

export type QuotaScope = { type: 'USER' | 'WORKSPACE' | 'GLOBAL'; id: string };

export async function assertAiRuntimeAvailable(tx: Prisma.TransactionClient): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ quarantined: boolean }>>`
    SELECT quarantined FROM ai_runtime_control WHERE id = 1 FOR SHARE
  `;
  if (rows[0]?.quarantined !== false) {
    throw new HttpError(503, 'AI_RESTORE_QUARANTINE', 'AI planning is disabled until restored quota usage is reconciled.');
  }
}

export function quotaScopes(userId: string, workspaceId: string): QuotaScope[] {
  const scopes: QuotaScope[] = [
    { type: 'GLOBAL', id: GLOBAL_SCOPE_ID },
    { type: 'USER', id: userId },
    { type: 'WORKSPACE', id: workspaceId },
  ];
  return scopes.sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
}

export function businessUsageDate(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === kind)?.value ?? '';
  return new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00.000Z`);
}

export async function reserveQuota(
  tx: Prisma.TransactionClient,
  input: { scopes: QuotaScope[]; usageDate: Date; maxInputTokens: number; maxOutputTokens: number; maxAttempts?: number },
): Promise<void> {
  await assertAiRuntimeAvailable(tx);
  const maxAttempts = input.maxAttempts ?? MAX_PROVIDER_ATTEMPTS;
  const ordered = [...input.scopes].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
  for (const scope of ordered) {
    await tx.$executeRaw`
      INSERT INTO ai_usage_daily (scope_type, scope_id, usage_date, updated_at)
      VALUES (${scope.type}::ai_usage_scope_type, ${scope.id}::uuid, ${input.usageDate}::date, now())
      ON CONFLICT (scope_type, scope_id, usage_date) DO NOTHING
    `;
    const rows = await tx.$queryRaw<Array<{
      operations_reserved: number; operations_used: number; calls_reserved: number; calls_used: number;
    }>>`
      SELECT operations_reserved, operations_used, calls_reserved, calls_used
      FROM ai_usage_daily
      WHERE scope_type = ${scope.type}::ai_usage_scope_type AND scope_id = ${scope.id}::uuid AND usage_date = ${input.usageDate}::date
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row || row.operations_reserved + row.operations_used + 1 > limits[scope.type]) {
      throw new HttpError(429, 'AI_QUOTA_EXCEEDED', 'The daily AI operation limit has been reached.');
    }
    await tx.$executeRaw`
      UPDATE ai_usage_daily SET
        operations_reserved = operations_reserved + 1,
        calls_reserved = calls_reserved + ${maxAttempts},
        input_tokens_reserved = input_tokens_reserved + ${BigInt(maxAttempts * input.maxInputTokens)},
        output_tokens_reserved = output_tokens_reserved + ${BigInt(maxAttempts * input.maxOutputTokens)},
        updated_at = now()
      WHERE scope_type = ${scope.type}::ai_usage_scope_type AND scope_id = ${scope.id}::uuid AND usage_date = ${input.usageDate}::date
    `;
  }
}

export async function recordProviderAttemptStart(
  tx: Prisma.TransactionClient,
  scopes: QuotaScope[],
  usageDate: Date,
): Promise<void> {
  for (const scope of [...scopes].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`))) {
    const changed = await tx.$executeRaw`
      UPDATE ai_usage_daily SET
        calls_reserved = calls_reserved - 1,
        calls_used = calls_used + 1,
        updated_at = now()
      WHERE scope_type = ${scope.type}::ai_usage_scope_type AND scope_id = ${scope.id}::uuid AND usage_date = ${usageDate}::date AND calls_reserved > 0
    `;
    if (changed !== 1) throw new Error('AI provider call quota reservation is missing.');
  }
}

export async function recordProviderTokenUsage(
  tx: Prisma.TransactionClient,
  scopes: QuotaScope[],
  usageDate: Date,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  for (const scope of [...scopes].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`))) {
    await tx.$executeRaw`
      UPDATE ai_usage_daily SET
        input_tokens_reserved = GREATEST(0, input_tokens_reserved - ${BigInt(inputTokens)}),
        input_tokens_used = input_tokens_used + ${BigInt(inputTokens)},
        output_tokens_reserved = GREATEST(0, output_tokens_reserved - ${BigInt(outputTokens)}),
        output_tokens_used = output_tokens_used + ${BigInt(outputTokens)},
        updated_at = now()
      WHERE scope_type = ${scope.type}::ai_usage_scope_type AND scope_id = ${scope.id}::uuid AND usage_date = ${usageDate}::date
    `;
  }
}

export async function settleQuota(
  tx: Prisma.TransactionClient,
  input: {
    scopes: QuotaScope[];
    usageDate: Date;
    providerCallsUsed: number;
    attemptLimit: number;
    inputTokensUsed: number;
    outputTokensUsed: number;
    maxInputTokens: number;
    maxOutputTokens: number;
  },
): Promise<void> {
  const callsToRelease = Math.max(0, input.attemptLimit - input.providerCallsUsed);
  const inputToRelease = Math.max(0, input.attemptLimit * input.maxInputTokens - input.inputTokensUsed);
  const outputToRelease = Math.max(0, input.attemptLimit * input.maxOutputTokens - input.outputTokensUsed);
  for (const scope of [...input.scopes].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`))) {
    await tx.$executeRaw`
      UPDATE ai_usage_daily SET
        operations_reserved = GREATEST(0, operations_reserved - 1),
        operations_used = operations_used + 1,
        calls_reserved = GREATEST(0, calls_reserved - ${callsToRelease}),
        input_tokens_reserved = GREATEST(0, input_tokens_reserved - ${BigInt(inputToRelease)}),
        output_tokens_reserved = GREATEST(0, output_tokens_reserved - ${BigInt(outputToRelease)}),
        updated_at = now()
      WHERE scope_type = ${scope.type}::ai_usage_scope_type AND scope_id = ${scope.id}::uuid AND usage_date = ${input.usageDate}::date
    `;
  }
}
