import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Mailer } from '@nestjs/mail';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import { type EmailTemplate, renderEmail } from '@/config/email/templates.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

// Background job that sends due emails from the outbox (on worker servers).
const sendEmails = 'email-outbox';

// Each pass takes up to 50 emails and sends 10 at a time, and keeps going
// (up to 20 passes) while there are more: a burst of sign-ups drains fast.
const batchSize = 50;
const parallel = 10;
const maxPasses = 20;
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
// sent by a background job on the worker servers, with retries, so a provider
// outage loses nothing. A new email is sent right away; a 5-second sweep picks
// up retries and anything missed.
// Sending uses @nestjs/mail (SendByte or SMTP, see email.module.ts).
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private processing = false;
  private lastPrunedAt = 0;
  // Tests only: the last email "sent" to each address.
  private readonly testEmails = new Map<string, Record<string, string>>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
    private readonly bullmq: BullmqService,
  ) {}

  onModuleInit(): void {
    this.bullmq.handle(sendEmails, () => this.processDueMessages(), {
      concurrency: 1,
    });
    if (this.isTest()) return;
    this.bullmq.onWorkerStart(() =>
      this.bullmq.schedule(
        sendEmails,
        'every-5-seconds',
        { everyMs: 5_000 },
        {},
      ),
    );
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
    // Send now instead of waiting for the sweep. If Redis is briefly down,
    // the email is still safe in the outbox and the sweep sends it.
    await this.bullmq
      .add(sendEmails, {}, { attempts: 1 })
      .catch(() => this.logger.warn('Email queued; the sweep will send it.'));
  }

  // Health: emails waiting to be sent, and ones that gave up.
  async outboxCounts(): Promise<{ waiting: number; failed: number }> {
    const db = this.prisma.db;
    const [waiting, failed] = await Promise.all([
      db.emailOutbox.count({
        where: { status: { in: ['pending', 'sending'] } },
      }),
      db.emailOutbox.count({ where: { status: 'failed' } }),
    ]);
    return { waiting, failed };
  }

  // Health: the email service in use.
  get provider(): 'sendbyte' | 'smtp' {
    return this.config.get<string>('SENDBYTE_API_KEY') ? 'sendbyte' : 'smtp';
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
      for (let pass = 0; pass < maxPasses; pass++) {
        const rows = await this.dueMessages(now);
        for (let i = 0; i < rows.length; i += parallel) {
          await Promise.all(
            rows.slice(i, i + parallel).map((row) => this.processOne(row)),
          );
        }
        if (rows.length < batchSize) break;
      }
    } finally {
      this.processing = false;
    }
  }

  private async dueMessages(now: Date): Promise<OutboxRow[]> {
    return (await this.prisma.db.emailOutbox.findMany({
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
  }

  private async processOne(row: OutboxRow): Promise<void> {
    const claimedAt = new Date();
    const claimed = await this.prisma.db.emailOutbox.updateMany({
      where: { id: row.id, status: row.status, lockedAt: row.lockedAt },
      data: {
        status: 'sending',
        lockedAt: claimedAt,
        attempts: { increment: 1 },
      },
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
      await this.fail(
        row.id,
        claimedAt,
        new Date(),
        attempt,
        'payload-decryption',
        true,
      );
      return;
    }

    try {
      const email = renderEmail(message.template, message.variables);
      await this.mailer.send({
        to: message.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        // The outbox id, so a retried send is not delivered twice (SendByte).
        idempotencyKey: row.id,
        // The outbox retries; one attempt per pass.
        retry: false,
      });
      await this.prisma.db.emailOutbox.updateMany({
        where: { id: row.id, status: 'sending', lockedAt: claimedAt },
        data: {
          status: 'sent',
          sentAt: new Date(),
          lockedAt: null,
          lastErrorCategory: null,
        },
      });
    } catch {
      await this.fail(
        row.id,
        claimedAt,
        new Date(),
        attempt,
        'provider-failure',
        false,
      );
    }
  }

  private async fail(
    id: string,
    claimedAt: Date,
    failedAt: Date,
    attempt: number,
    category: string,
    permanent: boolean,
  ): Promise<void> {
    const terminal = permanent || attempt >= maxAttempts;
    const delayMs = Math.min(300_000, 1_000 * 2 ** Math.min(attempt - 1, 8));
    await this.prisma.db.emailOutbox.updateMany({
      where: { id, status: 'sending', lockedAt: claimedAt },
      data: {
        status: terminal ? 'failed' : 'pending',
        availableAt: terminal
          ? failedAt
          : new Date(failedAt.getTime() + delayMs),
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
