import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { AiRetentionRepository } from '../modules/planner/retention.repository.js';
import { createLogger } from '../shared/logging/logger.js';
import { loadEnvironment } from '../shared/config/env.js';
import { createPrismaClient } from '../shared/db/prisma.js';

const MAX_PLANS_PER_RUN = 100;

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
  const environment = loadEnvironment();
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const logger = createLogger(environment);
  const prisma = createPrismaClient(environment.DATABASE_URL);
  try {
    await prisma.$connect();
    const retention = new AiRetentionRepository(prisma);
    let purgedPlans = 0;
    let jobsCancelled = 0;
    let jobsInterrupted = 0;
    for (let index = 0; index < MAX_PLANS_PER_RUN; index += 1) {
      const result = await retention.purgeOneExpiredPlan();
      if (!result.purged) break;
      purgedPlans += 1;
      jobsCancelled += result.jobsCancelled;
      jobsInterrupted += result.jobsInterrupted;
    }
    logger.info({ purgedPlans, jobsCancelled, jobsInterrupted, maxPlansPerRun: MAX_PLANS_PER_RUN }, 'AI planner retention cleanup finished');
  } finally {
    await prisma.$disconnect();
    await logger.flush();
  }
}

void main().catch(() => {
  process.stderr.write('AI planner retention cleanup failed.\n');
  process.exitCode = 1;
});
