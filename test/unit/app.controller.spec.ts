import { Test, TestingModule } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { vi } from 'vitest';
import { AppController } from '@/app/app.controller.js';
import { AppService } from '@/app/app.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: {
            db: {
              $queryRaw: vi.fn().mockRejectedValue(new Error('db offline')),
            },
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('returns an in-process liveness result', () => {
      expect(appController.live()).toEqual({ status: 'ok' });
    });

    it('fails readiness when PostgreSQL cannot answer', async () => {
      await expect(appController.ready()).rejects.toThrow();
    });
  });
});
