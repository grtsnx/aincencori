import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RoutineService } from '@/modules/routine/routine.service.js';

const routine = (enabled: boolean) => ({
  id: enabled ? 'enabled-routine' : 'paused-routine',
  userId: 'user-1',
  botId: null,
  name: 'Morning news',
  prompt: 'Summarize the news.',
  cron: '0 8 * * *',
  timezone: 'Africa/Lagos',
  enabled,
  lastRunAt: null,
  lastStatus: null,
  createdAt: new Date('2026-11-13T00:00:00.000Z'),
  updatedAt: new Date('2026-11-13T00:00:00.000Z'),
});

function createService(rows = [routine(true), routine(false)]) {
  let handler:
    | ((data: { routineId: string; manual?: boolean }) => Promise<void>)
    | undefined;
  let reconcile: (() => Promise<void>) | undefined;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const db = {
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: 'user-1' }]),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'user-1' ? { id: 'user-1' } : null),
      ),
    },
    routine: {
      findMany: vi.fn().mockResolvedValue(rows),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(byId.get(where.id) ?? null),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const bullmq = {
    handle: vi.fn(
      (_name: string, callback: typeof handler) => (handler = callback),
    ),
    onWorkerStart: vi.fn((callback: () => Promise<void>) => {
      reconcile = callback;
    }),
    schedule: vi.fn().mockResolvedValue(undefined),
    unschedule: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
  };
  const chat = {
    useRoutines: vi.fn(),
    runRoutine: vi.fn().mockResolvedValue('ok'),
  };
  const service = new RoutineService(
    { db } as never,
    bullmq as never,
    chat as never,
  );
  return {
    service,
    db,
    bullmq,
    chat,
    getHandler: () => handler,
    reconcile: () => reconcile,
  };
}

describe('RoutineService reliability', () => {
  it('restores enabled schedules and removes disabled schedules when a worker starts', async () => {
    const { service, bullmq, reconcile } = createService();
    service.onModuleInit();

    await reconcile()?.();

    expect(bullmq.schedule).toHaveBeenCalledWith(
      'routine-run',
      'enabled-routine',
      { cron: '0 8 * * *', timezone: 'Africa/Lagos' },
      { routineId: 'enabled-routine' },
    );
    expect(bullmq.unschedule).toHaveBeenCalledWith(
      'routine-run',
      'paused-routine',
    );
  });

  it('does not restore or run orphaned routines', async () => {
    const orphan = { ...routine(true), id: 'orphan-routine', userId: 'gone' };
    const { service, bullmq, chat, reconcile, getHandler } = createService([
      orphan,
    ]);
    service.onModuleInit();

    await reconcile()?.();
    await getHandler()?.({ routineId: orphan.id });

    expect(bullmq.schedule).not.toHaveBeenCalled();
    expect(bullmq.unschedule).toHaveBeenCalledWith('routine-run', orphan.id);
    expect(chat.runRoutine).not.toHaveBeenCalled();
  });

  it('skips queued scheduled runs for paused routines but permits manual runs', async () => {
    const { service, chat, getHandler } = createService([routine(false)]);
    service.onModuleInit();
    const handler = getHandler();
    if (!handler) throw new Error('Routine handler was not registered.');

    await handler({ routineId: 'paused-routine' });
    expect(chat.runRoutine).not.toHaveBeenCalled();

    await handler({ routineId: 'paused-routine', manual: true });
    expect(chat.runRoutine).toHaveBeenCalledTimes(1);
  });

  it('uses a serializable transaction to enforce the per-user limit', async () => {
    const row = routine(true);
    const transaction = vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        routine: {
          count: vi.fn().mockResolvedValue(24),
          create: vi.fn().mockResolvedValue(row),
        },
      }),
    );
    const service = new RoutineService(
      {
        db: {
          bot: { findFirst: vi.fn() },
          $transaction: transaction,
        },
      } as never,
      {
        schedule: vi.fn().mockResolvedValue(undefined),
      } as never,
      { useRoutines: vi.fn() } as never,
    );

    await service.create(
      { user: { id: 'user-1' } },
      {
        name: row.name,
        prompt: row.prompt,
        cron: row.cron,
        timezone: row.timezone,
      },
    );

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('removes the database row when schedule creation fails', async () => {
    const created = routine(true);
    const remove = vi.fn().mockResolvedValue(created);
    const service = new RoutineService(
      {
        db: {
          bot: { findFirst: vi.fn() },
          routine: { delete: remove },
          $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
            work({
              routine: {
                count: vi.fn().mockResolvedValue(0),
                create: vi.fn().mockResolvedValue(created),
              },
            }),
          ),
        },
      } as never,
      {
        schedule: vi.fn().mockRejectedValue(new Error('Redis offline')),
      } as never,
      { useRoutines: vi.fn() } as never,
    );

    await expect(
      service.create(
        { user: { id: 'user-1' } },
        {
          name: created.name,
          prompt: created.prompt,
          cron: created.cron,
          timezone: created.timezone,
        },
      ),
    ).rejects.toThrow('Redis offline');
    expect(remove).toHaveBeenCalledWith({ where: { id: created.id } });
  });

  it('returns the routine limit error after retrying a serialization conflict', async () => {
    const row = routine(true);
    let attempt = 0;
    const transaction = vi.fn(
      async (work: (tx: unknown) => Promise<unknown>) => {
        attempt += 1;
        if (attempt === 1) {
          await work({
            routine: {
              count: vi.fn().mockResolvedValue(24),
              create: vi.fn().mockRejectedValue({ code: 'P2034' }),
            },
          });
        }
        return work({
          routine: {
            count: vi.fn().mockResolvedValue(25),
            create: vi.fn().mockResolvedValue(row),
          },
        });
      },
    );
    const service = new RoutineService(
      {
        db: { bot: { findFirst: vi.fn() }, $transaction: transaction },
      } as never,
      { schedule: vi.fn() } as never,
      { useRoutines: vi.fn() } as never,
    );

    await expect(
      service.create(
        { user: { id: 'user-1' } },
        {
          name: row.name,
          prompt: row.prompt,
          cron: row.cron,
          timezone: row.timezone,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
