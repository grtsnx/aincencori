import { Test, TestingModule } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { vi } from 'vitest';
import { AppController } from '@/app/app.controller.js';
import { AppService } from '@/app/app.service.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { CencoriService } from '@/lib/cencori/cencori.service.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

// Readiness with each outside service up or down, all faked.
async function controller(options: {
  database?: boolean;
  redis?: boolean;
  cencori?: boolean;
  workers?: number;
}): Promise<AppController> {
  const {
    database = true,
    redis = true,
    cencori = true,
    workers = 1,
  } = options;
  const app: TestingModule = await Test.createTestingModule({
    imports: [TerminusModule],
    controllers: [AppController],
    providers: [
      AppService,
      {
        provide: PrismaService,
        useValue: {
          db: {
            $queryRaw: database
              ? vi.fn().mockResolvedValue([1])
              : vi.fn().mockRejectedValue(new Error('db offline')),
          },
        },
      },
      {
        provide: BullmqService,
        useValue: {
          ping: redis
            ? vi.fn().mockResolvedValue(undefined)
            : vi.fn().mockRejectedValue(new Error('redis offline')),
          workerCount: vi.fn().mockResolvedValue(workers),
        },
      },
      {
        provide: CencoriService,
        useValue: {
          isConfigured: true,
          modelsList: cencori
            ? vi.fn().mockResolvedValue({ data: [] })
            : vi.fn().mockRejectedValue(new Error('cencori offline')),
        },
      },
      {
        provide: EmailService,
        useValue: {
          provider: 'smtp',
          outboxCounts: vi.fn().mockResolvedValue({ waiting: 0, failed: 0 }),
        },
      },
    ],
  }).compile();
  return app.get(AppController);
}

describe('AppController', () => {
  it('should return "Hello World!"', async () => {
    expect((await controller({})).getHello()).toBe('Hello World!');
  });

  it('returns an in-process liveness result', async () => {
    expect((await controller({})).live()).toEqual({ status: 'ok' });
  });

  it('shows every service when all are up', async () => {
    const result = await (await controller({})).ready();
    expect(result).toMatchObject({
      database: { status: 'up' },
      redis: { status: 'up' },
      cencori: { status: 'up' },
      email: { status: 'up', provider: 'smtp', waiting: 0, failed: 0 },
      workers: { status: 'up', count: 1 },
    });
  });

  it('fails readiness when PostgreSQL or Redis cannot answer', async () => {
    await expect(
      (await controller({ database: false })).ready(),
    ).rejects.toThrow();
    await expect(
      (await controller({ redis: false })).ready(),
    ).rejects.toThrow();
  });

  it('stays ready when Cencori is down or no worker runs, but says so', async () => {
    const result = await (
      await controller({ cencori: false, workers: 0 })
    ).ready();
    expect(result).toMatchObject({
      database: { status: 'up' },
      cencori: { status: 'down' },
      workers: { status: 'down', count: 0 },
    });
  });
});
