import { Injectable } from '@nestjs/common';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { CencoriService } from '@/lib/cencori/cencori.service.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { R2Service } from '@/lib/r2/r2.service.js';

type Status = { status: 'up' | 'down'; [key: string]: unknown };

// Gives up on a slow check instead of hanging the health route.
function within<T>(ms: number, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timed out')), ms).unref(),
    ),
  ]);
}

async function timed(work: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await within(3_000, work());
  return Math.round(performance.now() - started);
}

@Injectable()
export class AppService {
  // Cencori is asked at most every 30 seconds, however often health is checked.
  private cencoriCheck?: { at: number; result: Status };

  constructor(
    private readonly prisma: PrismaService,
    private readonly bullmq: BullmqService,
    private readonly cencori: CencoriService,
    private readonly email: EmailService,
    private readonly r2: R2Service,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  // Must work for the API to take traffic.
  async database(): Promise<Status> {
    const latencyMs = await timed(() => this.prisma.db.$queryRaw`SELECT 1`);
    return { status: 'up', latencyMs };
  }

  async redis(): Promise<Status> {
    const latencyMs = await timed(() => this.bullmq.ping());
    return { status: 'up', latencyMs };
  }

  // Shown, but never makes the API "not ready": without them sign-in and
  // most routes still work.
  async optional(): Promise<Record<string, Status>> {
    const [cencori, email, workers, storage] = await Promise.all([
      this.checkCencori(),
      this.checkEmail(),
      this.checkWorkers(),
      this.checkStorage(),
    ]);
    return { cencori, email, workers, storage };
  }

  private async checkCencori(): Promise<Status> {
    if (!this.cencori.isConfigured) {
      return { status: 'down', message: 'CENCORI_API_KEY is not set.' };
    }
    const cached = this.cencoriCheck;
    if (cached && Date.now() - cached.at < 30_000) return cached.result;
    let result: Status;
    try {
      const latencyMs = await timed(() =>
        this.cencori.modelsList({ limit: 1 }),
      );
      result = { status: 'up', latencyMs };
    } catch {
      result = { status: 'down', message: 'Cencori did not answer.' };
    }
    this.cencoriCheck = { at: Date.now(), result };
    return result;
  }

  private async checkEmail(): Promise<Status> {
    try {
      const outbox = await within(3_000, this.email.outboxCounts());
      return { status: 'up', provider: this.email.provider, ...outbox };
    } catch {
      return { status: 'down', provider: this.email.provider };
    }
  }

  // File storage (R2): without it chats still work, files are just not kept.
  private async checkStorage(): Promise<Status> {
    try {
      const latencyMs = await timed(() => this.r2.ping());
      return { status: 'up', latencyMs };
    } catch {
      return { status: 'down', message: 'File storage did not answer.' };
    }
  }

  // Jobs (emails, routines) only run while at least one worker is on.
  private async checkWorkers(): Promise<Status> {
    try {
      const count = await within(
        3_000,
        this.bullmq.workerCount('email-outbox'),
      );
      return count > 0
        ? { status: 'up', count }
        : { status: 'down', count, message: 'No worker is running.' };
    } catch {
      return { status: 'down', message: 'Could not reach Redis.' };
    }
  }
}
