import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Mailer } from '@nestjs/mail';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import { type EmailTemplate, renderEmail } from '@/config/email/templates.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

const batchSize = 10;
const leaseMs = 5 * 60_000;
const retentionMs = 30 * 24 * 60 * 60_000;
const maxAttempts = 8;

interface OutboundMessage {
  template: EmailTemplate;
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

// Every email goes through an outbox: saved (encrypted) in Postgres first, then
// sent by a background loop with retries, so a provider outage loses nothing.
// Sending uses @nestjs/mail (Resend or SMTP, see email.module.ts).
@Injectable()
export class EmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name);
  private timer?: ReturnType<typeof setInterval>;
  private processing = false;
  private lastPrunedAt = 0;
  // Tests only: the last email "sent" to each address.
  private readonly testEmails = new Map<string, Record<string, string>>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
  ) {}

  onModuleInit(): void {
    if (this.isTest()) return;
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

  // Queues an email. Tests keep it in memory instead (read with lastTestEmail).
  async enqueue(
    template: EmailTemplate,
    to: string,
    variables: Record<string, string>,
  ): Promise<void> {
    if (this.isTest()) {
      this.testEmails.set(to, variables);
      return;
    }
    const payload = await symmetricEncrypt({
      key: this.config.getOrThrow<string>('BETTER_AUTH_SECRET'),
      data: JSON.stringify({
        template,
        to,
        variables,
      } satisfies OutboundMessage),
    });
    await this.prisma.db.emailOutbox.create({
      data: {
        id: randomUUID(),
        payload,
        status: 'pending',
        attempts: 0,
        availableAt: new Date(),
      },
    });
  }

  // Tests only: the variables of the last email to an address (e.g. otpCode).
  lastTestEmail(to: string): Record<string, string> | undefined {
    return this.testEmails.get(to);
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
            {
              status: 'sending',
              lockedAt: { lt: new Date(now.getTime() - leaseMs) },
            },
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
      const email = renderEmail(message.template, message.variables);
      await this.mailer.send({
        to: message.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        // The outbox id, so a retried send is not delivered twice (Resend).
        idempotencyKey: row.id,
        // The outbox retries; one attempt per pass.
        retry: false,
      });
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
    this.logger.error(
      `Email outbox ${id} failed (${category}, attempt ${attempt}).`,
    );
  }

  private async pruneOldMessages(now: Date): Promise<void> {
    if (now.getTime() - this.lastPrunedAt < 24 * 60 * 60_000) return;
    const cutoff = new Date(now.getTime() - retentionMs);
    await this.prisma.db.emailOutbox.deleteMany({
      where: {
        OR: [
          { status: 'sent', sentAt: { lt: cutoff } },
          { status: 'failed', createdAt: { lt: cutoff } },
        ],
      },
    });
    this.lastPrunedAt = now.getTime();
  }

  private isTest(): boolean {
    return this.config.get<string>('NODE_ENV') === 'test';
  }
}
