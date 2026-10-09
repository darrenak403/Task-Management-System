import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from '../../src/shared/db/prisma.js';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export function createTestDatabase(): PrismaClient {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required for integration tests.');
  return createPrismaClient(testDatabaseUrl);
}

export async function resetTestDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`
    TRUNCATE TABLE "ai_usage_daily", "realtime_events", "ai_imports", "ai_jobs", "ai_plan_versions", "ai_plans",
      "task_dependencies", "task_subtasks", "tasks", "team_members", "teams", "workspace_members", "workspaces",
      "user_gemini_credentials", "sessions", "users" CASCADE
  `;
  await prisma.$executeRaw`
    UPDATE realtime_clock
    SET epoch = gen_random_uuid(), last_seq = 0, watermark_id = gen_random_uuid(),
        epoch_checkpoint_id = gen_random_uuid(), purged_through = 0
    WHERE id = 1
  `;
  await prisma.$executeRaw`UPDATE realtime_clock SET watermark_id = epoch_checkpoint_id WHERE id = 1`;
}
