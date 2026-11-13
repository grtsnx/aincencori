import { describe, expect, it, vi } from 'vitest';
import { AppService } from '@/app/app.service.js';

describe('AppService readiness checks', () => {
  it('shares one in-flight Cencori health request across concurrent checks', async () => {
    let resolveModels: ((value: { data: unknown[] }) => void) | undefined;
    const modelsList = vi.fn(
      () =>
        new Promise<{ data: unknown[] }>((resolve) => {
          resolveModels = resolve;
        }),
    );
    const service = new AppService(
      { db: { $queryRaw: vi.fn().mockResolvedValue([]) } } as never,
      {
        ping: vi.fn().mockResolvedValue(undefined),
        workerCount: vi.fn().mockResolvedValue(1),
      } as never,
      { isConfigured: true, modelsList } as never,
      {
        provider: 'smtp',
        outboxCounts: vi.fn().mockResolvedValue({ waiting: 0, failed: 0 }),
      } as never,
      { ping: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const first = service.optional();
    const second = service.optional();
    await Promise.resolve();
    expect(modelsList).toHaveBeenCalledTimes(1);
    resolveModels?.({ data: [] });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });
});
