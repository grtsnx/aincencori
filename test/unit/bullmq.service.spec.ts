import { describe, expect, it, vi } from 'vitest';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';

const config = (values: Record<string, string>) =>
  ({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  }) as never;

describe('BullmqService (tests run jobs straight away)', () => {
  const service = () =>
    new BullmqService(
      config({ NODE_ENV: 'test', REDIS_URL: 'redis://localhost:6380' }),
    );

  it('runs a queued job with its data', async () => {
    const queue = service();
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.handle('send-report', handler);

    await queue.add('send-report', { id: 1 });

    expect(handler).toHaveBeenCalledWith({ id: 1 }, { attempt: 1 });
  });

  it('refuses a second handler for the same job, and jobs with none', async () => {
    const queue = service();
    queue.handle('a', vi.fn());

    expect(() => queue.handle('a', vi.fn())).toThrow('already has a handler');
    await expect(queue.add('b', {})).rejects.toThrow('has no handler');
  });

  it('keeps and removes timetables', async () => {
    const queue = service();

    await queue.schedule(
      'routine-run',
      'r1',
      { cron: '0 8 * * *', timezone: 'Africa/Lagos' },
      {},
    );
    expect(queue.testSchedule('routine-run', 'r1')).toEqual({
      cron: '0 8 * * *',
      timezone: 'Africa/Lagos',
    });

    await queue.unschedule('routine-run', 'r1');
    expect(queue.testSchedule('routine-run', 'r1')).toBeUndefined();
  });
});
