import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { rotateRealtimeEpoch } from '../modules/realtime/clock.js';
import { createLogger } from '../shared/logging/logger.js';
import { loadEnvironment } from '../shared/config/env.js';
import { createPrismaClient } from '../shared/db/prisma.js';

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
  if (process.env.CONFIRM_RESTORE_EPOCH_ROTATION !== 'yes') {
    throw new Error('Set CONFIRM_RESTORE_EPOCH_ROTATION=yes after stopping API traffic and restoring the database.');
  }
  const environment = loadEnvironment();
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const logger = createLogger(environment);
  const prisma = createPrismaClient(environment.DATABASE_URL);
  try {
    await prisma.$connect();
    const result = await rotateRealtimeEpoch(prisma);
    logger.info(result, 'Realtime epoch rotated; restored sessions were revoked');
  } finally {
    await prisma.$disconnect();
    await logger.flush();
  }
}

void main().catch(() => {
  process.stderr.write('Post-restore realtime epoch rotation failed.\n');
  process.exitCode = 1;
});
