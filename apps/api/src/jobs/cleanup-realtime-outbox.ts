import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { RealtimeRepository } from '../modules/realtime/realtime.repository.js';
import { createLogger } from '../shared/logging/logger.js';
import { loadEnvironment } from '../shared/config/env.js';
import { createPrismaClient } from '../shared/db/prisma.js';

const BATCH_SIZE = 5_000;
const MAX_BATCHES_PER_RUN = 10;

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
  const environment = loadEnvironment();
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const logger = createLogger(environment);
  const prisma = createPrismaClient(environment.DATABASE_URL);
  try {
    await prisma.$connect();
    const repository = new RealtimeRepository(prisma);
    let deletedCount = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const deleted = await repository.cleanExpiredPrefix(BATCH_SIZE);
      deletedCount += deleted;
      if (deleted < BATCH_SIZE) break;
    }
    logger.info({ deletedCount, maxRowsPerRun: BATCH_SIZE * MAX_BATCHES_PER_RUN }, 'Realtime outbox retention cleanup finished');
  } finally {
    await prisma.$disconnect();
    await logger.flush();
  }
}

void main().catch(() => {
  process.stderr.write('Realtime outbox cleanup failed.\n');
  process.exitCode = 1;
});
