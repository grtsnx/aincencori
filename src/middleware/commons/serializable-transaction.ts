import { Prisma, type PrismaClient } from '@/generated/prisma/client.js';

const maxAttempts = 3;

// A serializable transaction may fail if a concurrent request changed rows
// covered by its reads. Retrying gives it a fresh snapshot and preserves caps.
export async function serializableTransaction<T>(
  db: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      });
    } catch (error) {
      if (!isSerializationConflict(error) || attempt >= maxAttempts) throw error;
    }
  }
}

export function isSerializationConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message, cause } = error as {
    code?: unknown;
    message?: unknown;
    cause?: { kind?: unknown; originalCode?: unknown };
  };
  return (
    code === 'P2034' ||
    message === 'TransactionWriteConflict' ||
    cause?.kind === 'TransactionWriteConflict' ||
    cause?.originalCode === '40001'
  );
}
