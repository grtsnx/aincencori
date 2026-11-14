import { describe, expect, it, vi } from 'vitest';
import { serializableTransaction } from '@/middleware';

describe('serializableTransaction', () => {
  it('retries serialization failures with a fresh transaction', async () => {
    const tx = {};
    const db = {
      $transaction: vi
        .fn()
        .mockRejectedValueOnce({ code: 'P2034' })
        .mockImplementationOnce((work: (client: unknown) => unknown) =>
          Promise.resolve(work(tx)),
        ),
    };

    const result = await serializableTransaction(db as never, async () => 'ok');

    expect(result).toBe('ok');
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.$transaction).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('does not retry application errors', async () => {
    const error = new Error('validation failed');
    const db = { $transaction: vi.fn().mockRejectedValue(error) };

    await expect(
      serializableTransaction(db as never, async () => 'unused'),
    ).rejects.toBe(error);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
