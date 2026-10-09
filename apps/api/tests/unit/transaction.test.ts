import { describe, expect, it } from 'vitest';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client.js';
import type { HttpError } from '../../src/shared/http/error-handler.js';
import { runTransactionWithRetry } from '../../src/shared/db/transaction.js';

function writeConflict(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Transaction write conflict.', {
    code: 'P2034',
    clientVersion: '7.10.0',
  });
}

describe('transaction retry policy', () => {
  it('retries a confirmed Prisma write conflict at most twice', async () => {
    let transactionAttempts = 0;
    let callbackAttempts = 0;
    const client = {
      async $transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
        transactionAttempts += 1;
        const result = await operation({} as Prisma.TransactionClient);
        if (transactionAttempts < 3) throw writeConflict();
        return result;
      },
    } as unknown as PrismaClient;

    const result = await runTransactionWithRetry(client, async () => {
      callbackAttempts += 1;
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(transactionAttempts).toBe(3);
    expect(callbackAttempts).toBe(3);
  });

  it('maps a third confirmed abort to a retryable conflict response', async () => {
    let transactionAttempts = 0;
    const client = {
      async $transaction() {
        transactionAttempts += 1;
        throw writeConflict();
      },
    } as unknown as PrismaClient;

    await expect(runTransactionWithRetry(client, async () => undefined)).rejects.toMatchObject<HttpError>({
      statusCode: 409,
      code: 'WRITE_CONFLICT',
    });
    expect(transactionAttempts).toBe(3);
  });

  it('retries raw-query P2010 only when Prisma exposes a known PostgreSQL abort SQLSTATE', async () => {
    let transactionAttempts = 0;
    const client = {
      async $transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
        transactionAttempts += 1;
        const result = await operation({} as Prisma.TransactionClient);
        if (transactionAttempts === 1) {
          throw new Prisma.PrismaClientKnownRequestError('Raw query failed.', {
            code: 'P2010',
            clientVersion: '7.10.0',
            meta: { driverAdapterError: { cause: { originalCode: '40P01' } } },
          });
        }
        return result;
      },
    } as unknown as PrismaClient;

    const result = await runTransactionWithRetry(client, async () => 'committed');
    expect(result).toBe('committed');
    expect(transactionAttempts).toBe(2);
  });

  it('does not retry raw-query errors without a confirmed deadlock or serialization SQLSTATE', async () => {
    let transactionAttempts = 0;
    const failure = new Prisma.PrismaClientKnownRequestError('Raw query failed.', {
      code: 'P2010',
      clientVersion: '7.10.0',
      meta: { driverAdapterError: { cause: { originalCode: '23505' } } },
    });
    const client = {
      async $transaction() {
        transactionAttempts += 1;
        throw failure;
      },
    } as unknown as PrismaClient;

    await expect(runTransactionWithRetry(client, async () => undefined)).rejects.toBe(failure);
    expect(transactionAttempts).toBe(1);
  });

  it('does not retry validation, authorization, or unknown failures', async () => {
    let transactionAttempts = 0;
    const failure = new Prisma.PrismaClientKnownRequestError('Unique constraint failed.', {
      code: 'P2002',
      clientVersion: '7.10.0',
    });
    const client = {
      async $transaction() {
        transactionAttempts += 1;
        throw failure;
      },
    } as unknown as PrismaClient;

    await expect(runTransactionWithRetry(client, async () => undefined)).rejects.toBe(failure);
    expect(transactionAttempts).toBe(1);
  });
});
