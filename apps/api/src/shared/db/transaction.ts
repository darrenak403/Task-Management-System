import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../http/error-handler.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 10;
type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

function isConfirmedTransactionAbort(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010' || typeof error.meta !== 'object' || error.meta === null) return false;

  const driverAdapterError = error.meta.driverAdapterError;
  if (typeof driverAdapterError !== 'object' || driverAdapterError === null || !('cause' in driverAdapterError)) return false;
  const cause = driverAdapterError.cause;
  if (typeof cause !== 'object' || cause === null || !('originalCode' in cause)) return false;
  return cause.originalCode === '40001' || cause.originalCode === '40P01';
}

export async function runTransactionWithRetry<T>(
  prisma: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await prisma.$transaction(operation, options);
    } catch (error) {
      if (!isConfirmedTransactionAbort(error)) throw error;
      if (retry >= MAX_RETRIES) {
        throw new HttpError(409, 'WRITE_CONFLICT', 'This change conflicted with another update. Please retry.');
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (retry + 1)));
    }
  }
}
