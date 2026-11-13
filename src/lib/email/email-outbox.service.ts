import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import type { EmailTemplateId } from '@better-auth/infra';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { EMAIL_SENDER, type EmailSender } from './email.tokens.js';

const batchSize = 10;
const leaseMs = 5 * 60_000;
const retentionMs = 30 * 24 * 60 * 60_000;
const maxAttempts = 8;

interface OutboundMessage {
  template: EmailTemplateId;
  to: string;
  variables: Record<string, string>;
}

interface OutboxRow {
  id: string;
  payload: string;
  status: string;
  attempts: number;
  lockedAt: Date | null;
}

@Injectable()
export class EmailOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailOutboxService.name);
  private timer?: ReturnType<typeof setInterval>;
  private processing = false;
  private lastPrunedAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => {
      void this.processDueMessages().catch(() => {
        this.logger.error('Email outbox polling failed.');
      });
    }, 5_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueue(
    template: EmailTemplateId,
    to: string,
    variables: Record<string, string>,
  ): Promise<void> {
    const payload = await symmetricEncrypt({
      key: this.config.getOrThrow<string>('BETTER_AUTH_SECRET'),
      data: JSON.stringify({ template, to, variables } satisfies OutboundMessage),
    });
    await this.prisma.db.emailOutbox.create({
      data: { id: randomUUID(), payload },
    });
  }

  async processDueMessages(now = new Date()): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.pruneOldMessages(now);
      const rows = (await this.prisma.db.emailOutbox.findMany({
        where: {
          availableAt: { lte: now },
          OR: [
            { status: 'pending' },
            { status: 'sending', lockedAt: { lt: new Date(now.getTime() - leaseMs) } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      })) as OutboxRow[];

      for (const row of rows) await this.processOne(row, now);
    } finally {
      this.processing = false;
    }
  }

  private async processOne(row: OutboxRow, now: Date): Promise<void> {
    const claimed = await this.prisma.db.emailOutbox.updateMany({
      where: { id: row.id, status: row.status, lockedAt: row.lockedAt },
      data: { status: 'sending', lockedAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return;

    const attempt = row.attempts + 1;
    let message: OutboundMessage;
    try {
      const plaintext = await symmetricDecrypt({
        key: this.config.getOrThrow<string>('BETTER_AUTH_SECRET'),
        data: row.payload,
      });
      message = JSON.parse(plaintext) as OutboundMessage;
    } catch {
      await this.fail(row.id, now, attempt, 'payload-decryption', true);
      return;
    }

    try {
      await this.sender(message);
      await this.prisma.db.emailOutbox.updateMany({
        where: { id: row.id, status: 'sending', lockedAt: now },
        data: {
          status: 'sent',
          sentAt: now,
          lockedAt: null,
          lastErrorCategory: null,
        },
      });
    } catch {
      await this.fail(row.id, now, attempt, 'provider-failure', false);
    }
  }

  private async fail(
    id: string,
    now: Date,
    attempt: number,
    category: string,
    permanent: boolean,
  ): Promise<void> {
    const terminal = permanent || attempt >= maxAttempts;
    const delayMs = Math.min(300_000, 1_000 * 2 ** Math.min(attempt - 1, 8));
    await this.prisma.db.emailOutbox.updateMany({
      where: { id, status: 'sending', lockedAt: now },
      data: {
        status: terminal ? 'failed' : 'pending',
        availableAt: terminal ? now : new Date(now.getTime() + delayMs),
        lockedAt: null,
        lastErrorCategory: category,
      },
    });
    this.logger.error(`Email outbox ${id} failed (${category}, attempt ${attempt}).`);
  }

  private async pruneOldMessages(now: Date): Promise<void> {
    if (now.getTime() - this.lastPrunedAt < 24 * 60 * 60_000) return;
    this.lastPrunedAt = now.getTime();
    const cutoff = new Date(now.getTime() - retentionMs);
    await this.prisma.db.emailOutbox.deleteMany({
      where: {
        OR: [
          { status: 'sent', sentAt: { lt: cutoff } },
          { status: 'failed', createdAt: { lt: cutoff } },
        ],
      },
    });
  }
}
