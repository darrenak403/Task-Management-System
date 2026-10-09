import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { AuthRepository } from '../modules/auth/auth.repository.js';
import { createLogger } from '../shared/logging/logger.js';
import { loadEnvironment } from '../shared/config/env.js';
import { createPrismaClient } from '../shared/db/prisma.js';

const BATCH_SIZE = 1_000;
const MAX_BATCHES_PER_RUN = 10;

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
  const environment = loadEnvironment();
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const logger = createLogger(environment);
  const prisma = createPrismaClient(environment.DATABASE_URL);
  try {
    await prisma.$connect();
    const repository = new AuthRepository(prisma);
    let deletedCount = 0;

    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const deleted = await repository.deleteExpiredSessionsBatch(BATCH_SIZE);
      deletedCount += deleted;
      if (deleted < BATCH_SIZE) break;
    }

    logger.info({ deletedCount, maxRowsPerRun: BATCH_SIZE * MAX_BATCHES_PER_RUN }, 'Expired sessions cleanup finished');
  } finally {
    await prisma.$disconnect();
    await logger.flush();
  }
}

void main().catch(() => {
  process.stderr.write('Expired session cleanup failed.\n');
  process.exitCode = 1;
});
