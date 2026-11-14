import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingHttpHeaders } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AlertDto } from '@/dto';
import {
  type AuthSession,
  BetterAuthService,
} from '@/lib/better-auth/better-auth.service.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { assertStaff, postToWebhook, useAlertSink } from '@/middleware';

// The same alert within this time adds to its count; no new email.
const quietMs = 10 * 60_000;
const keepDays = 90;

// Our team's alerts: when an outside service (web search, InstaBox, Bachs,
// Cencori...) or our own server fails. Users only ever see a plain message;
// the real error is kept here, emailed to every admin, and posted to
// ALERT_WEBHOOK_URL when set.
@Injectable()
export class AlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly betterAuth: BetterAuthService,
  ) {}

  onModuleInit(): void {
    useAlertSink((alert) => {
      void this.raise(alert.source, alert.title, alert.detail);
    });
  }

  onModuleDestroy(): void {
    useAlertSink(undefined);
  }

  // Keeps the alert and tells the team, once per 10 minutes per title.
  async raise(source: string, title: string, detail?: string): Promise<void> {
    try {
      const db = this.prisma.db;
      const since = new Date(Date.now() - quietMs);
      const recent = await db.alert.findFirst({
        where: { title, lastAt: { gte: since } },
        orderBy: { lastAt: 'desc' },
      });
      if (recent) {
        await db.alert.update({
          where: { id: recent.id },
          data: { count: { increment: 1 }, lastAt: new Date() },
        });
        return;
      }
      await db.alert.create({
        data: {
          id: randomUUID(),
          source,
          title: title.slice(0, 300),
          detail: detail?.slice(0, 4000) ?? null,
        },
      });
      await db.alert.deleteMany({
        where: {
          lastAt: { lt: new Date(Date.now() - keepDays * 24 * 60 * 60_000) },
        },
      });
      postToWebhook(
        this.config.get<string>('ALERT_WEBHOOK_URL'),
        `[${source}] ${title}`,
        detail,
      );
      await this.emailAdmins(source, title, detail);
    } catch {
      // An alert must never cause a second error.
      this.logger.error(`An alert could not be saved: ${title}`);
    }
  }

  // Latest alerts first, for staff.
  async list(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
  ): Promise<AlertDto[]> {
    await assertStaff(
      { betterAuth: this.betterAuth, prisma: this.prisma },
      auth,
      headers,
      { activity: ['read'] },
    );
    return this.prisma.db.alert.findMany({
      orderBy: { lastAt: 'desc' },
      take: 200,
    });
  }

  private async emailAdmins(
    source: string,
    title: string,
    detail?: string,
  ): Promise<void> {
    const admins = await this.prisma.db.user.findMany({
      where: { role: { contains: 'admin' }, banned: { not: true } },
      select: { email: true },
      take: 20,
    });
    const appName = this.config.get<string>('PLATFORM_NAME') ?? 'Agentic';
    for (const admin of admins) {
      await this.email.enqueue('alert', admin.email, {
        appName,
        source,
        title,
        detail: detail ?? '(no details)',
      });
    }
  }
}
