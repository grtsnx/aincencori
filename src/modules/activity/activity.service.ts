import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { randomUUID } from 'node:crypto';
import { purgeActivityJob } from '@/config/agents/jobs.js';
import {
  activityRetentionDays,
  pendingApprovalDays,
} from '@/config/agents/limits.js';
import type {
  ActivityDto,
  AdminActivityQueryDto,
  ListActivityQueryDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { BetterAuthService } from '@/lib/better-auth/better-auth.service.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { assertStaff } from '@/middleware';

export interface ActivityEntry {
  // Whose account it is about.
  userId?: string | null;
  // "user", "staff:<id>", "agent:<name>" or "system".
  actor: string;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
}

// The activity log: what happened in each account, so users can see what
// their AI did for them, and staff can look into problems. Writing never
// fails the work that is being logged.
@Injectable()
export class ActivityService implements OnModuleInit {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bullmq: BullmqService,
    private readonly betterAuth: BetterAuthService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.betterAuth.useActivity((entry) => this.log(entry));
    this.bullmq.handle(purgeActivityJob, () => this.purge());
    await this.bullmq
      .schedule(
        purgeActivityJob,
        'daily',
        { cron: '0 3 * * *', timezone: 'UTC' },
        {},
      )
      .catch(() =>
        this.logger.warn('The activity clean-up was not scheduled.'),
      );
  }

  // Adds an entry in the background.
  log(entry: ActivityEntry): void {
    this.prisma.db.activityLog
      .create({
        data: {
          id: randomUUID(),
          userId: entry.userId ?? null,
          actor: entry.actor.slice(0, 200),
          action: entry.action.slice(0, 100),
          target: entry.target?.slice(0, 200) ?? null,
          detail: entry.detail?.slice(0, 500) ?? null,
          ip: entry.ip?.slice(0, 100) ?? null,
        },
      })
      .catch(() => this.logger.error('An activity entry was not saved.'));
  }

  // The signed-in user's own activity, newest first.
  list(auth: AuthSession, query: ListActivityQueryDto): Promise<ActivityDto[]> {
    return this.page({ userId: auth.user.id }, query);
  }

  // Any account's activity, for staff.
  async listAll(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    query: AdminActivityQueryDto,
  ): Promise<ActivityDto[]> {
    await assertStaff(
      { betterAuth: this.betterAuth, prisma: this.prisma },
      auth,
      headers,
      { activity: ['read'] },
    );
    return this.page(query.userId ? { userId: query.userId } : {}, query);
  }

  private page(
    where: { userId?: string },
    query: ListActivityQueryDto,
  ): Promise<ActivityDto[]> {
    return this.prisma.db.activityLog.findMany({
      where: { ...where, ...(query.action ? { action: query.action } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
  }

  // Old entries go, and so do approvals nobody answered.
  private async purge(): Promise<void> {
    const day = 24 * 60 * 60_000;
    await this.prisma.db.activityLog.deleteMany({
      where: {
        createdAt: { lt: new Date(Date.now() - activityRetentionDays * day) },
      },
    });
    await this.prisma.db.pendingApproval.deleteMany({
      where: {
        createdAt: { lt: new Date(Date.now() - pendingApprovalDays * day) },
      },
    });
    await this.prisma.db.toolRule.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}
