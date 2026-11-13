import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import {
  billingPlans,
  type BillingPlanName,
} from '@/config/billing/plans.js';
import type {
  SetBillingPlanDto,
  UsageDto,
  UsageOverviewDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { BetterAuthService } from '@/lib/better-auth/better-auth.service.js';
import { CencoriService } from '@/lib/cencori/cencori.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { assertStaff, type ModelUsage } from '@/middleware';
import { ActivityService } from '../activity/activity.service.js';

// What kind of work a run was, from the metadata it was started with.
export function usageKind(metadata?: Record<string, string>): string {
  if (metadata?.kind) return metadata.kind;
  if (metadata?.listingId) return 'review';
  if (metadata?.planId) return 'plan';
  if (metadata?.routineId) return 'routine';
  if (metadata?.groupId) return 'group';
  return 'chat';
}

// Our own safety reviews are paid by us, not taken from the user's allowance.
const freeKinds = ['review'];

const monthStart = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const nextMonthStart = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const today = () => new Date(new Date().toISOString().slice(0, 10));
const round = (value: number) => Math.round(value * 1e6) / 1e6;

// Usage and plans: counts what every user's AI work costs (Cencori reports
// it after each model call), and stops new AI work once a user has used
// their monthly allowance. Payment is not handled here yet; staff set plans.
@Injectable()
export class UsageService implements OnModuleInit {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cencori: CencoriService,
    private readonly betterAuth: BetterAuthService,
    private readonly activity: ActivityService,
  ) {}

  onModuleInit(): void {
    this.cencori.useUsageRecorder((userId, metadata, usage) => {
      void this.record(userId, usageKind(metadata), usage);
    });
  }

  // Adds one model call to today's row. One statement, so two calls at the
  // same moment both count.
  async record(userId: string, kind: string, usage: ModelUsage): Promise<void> {
    try {
      await this.prisma.db.$executeRaw`
        INSERT INTO "usageDay" ("userId", "day", "kind", "calls", "inputTokens", "outputTokens", "costUsd")
        VALUES (${userId}, ${today()}::date, ${kind}, 1, ${usage.inputTokens}, ${usage.outputTokens}, ${usage.costUsd})
        ON CONFLICT ("userId", "day", "kind") DO UPDATE SET
          "calls" = "usageDay"."calls" + 1,
          "inputTokens" = "usageDay"."inputTokens" + EXCLUDED."inputTokens",
          "outputTokens" = "usageDay"."outputTokens" + EXCLUDED."outputTokens",
          "costUsd" = "usageDay"."costUsd" + EXCLUDED."costUsd"`;
    } catch {
      this.logger.error('Usage was not saved.');
    }
  }

  // Stops new AI work when this month's allowance is used up.
  async assertAllowance(userId: string): Promise<void> {
    const [limit, used] = await Promise.all([
      this.limitFor(userId),
      this.usedThisMonth(userId),
    ]);
    if (used < limit.monthlyLimitUsd) return;
    const renews = nextMonthStart().toISOString().slice(0, 10);
    throw new HttpException(
      `You have used this month's AI allowance. It starts again on ${renews}, or upgrade your plan.`,
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  // The signed-in user's plan and this month's usage.
  mine(auth: AuthSession): Promise<UsageDto> {
    return this.summary(auth.user.id);
  }

  // One user's usage, for staff.
  async forUser(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    userId: string,
  ): Promise<UsageDto> {
    await this.staff(auth, headers, 'read');
    await this.userExists(userId);
    return this.summary(userId);
  }

  // Everyone's usage this month, biggest users first, for staff.
  async overview(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
  ): Promise<UsageOverviewDto> {
    await this.staff(auth, headers, 'read');
    const db = this.prisma.db;
    const where = { day: { gte: monthStart() } };
    const [totals, users, perUser] = await Promise.all([
      db.usageDay.aggregate({ where, _sum: { costUsd: true, calls: true } }),
      db.usageDay.groupBy({ by: ['userId'], where }),
      db.usageDay.groupBy({
        by: ['userId'],
        where: { ...where, kind: { notIn: freeKinds } },
        _sum: { costUsd: true },
        orderBy: { _sum: { costUsd: 'desc' } },
        take: 20,
      }),
    ]);
    const ids = perUser.map((row) => row.userId);
    const [people, plans] = await Promise.all([
      db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, email: true },
      }),
      db.billingPlan.findMany({ where: { userId: { in: ids } } }),
    ]);
    return {
      usedUsd: round(totals._sum.costUsd ?? 0),
      calls: totals._sum.calls ?? 0,
      activeUsers: users.length,
      topUsers: perUser.map((row) => {
        const plan = plans.find((p) => p.userId === row.userId);
        return {
          userId: row.userId,
          email: people.find((p) => p.id === row.userId)?.email ?? '',
          plan: plan?.plan ?? 'free',
          usedUsd: round(row._sum.costUsd ?? 0),
          monthlyLimitUsd: this.limitOf(plan).monthlyLimitUsd,
        };
      }),
    };
  }

  // Staff move a user to a plan (or give them their own allowance).
  async setPlan(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    userId: string,
    body: SetBillingPlanDto,
  ): Promise<UsageDto> {
    await this.staff(auth, headers, 'update');
    await this.userExists(userId);
    const data = {
      plan: body.plan,
      ...(body.monthlyLimitUsd !== undefined && {
        monthlyLimitUsd: body.monthlyLimitUsd,
      }),
    };
    await this.prisma.db.billingPlan.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    this.activity.log({
      userId,
      actor: `staff:${auth.user.id}`,
      action: 'plan.changed',
      target: body.plan,
      detail:
        typeof body.monthlyLimitUsd === 'number'
          ? `Allowance set to $${body.monthlyLimitUsd} a month.`
          : null,
    });
    return this.summary(userId);
  }

  private async summary(userId: string): Promise<UsageDto> {
    const [limit, rows] = await Promise.all([
      this.limitFor(userId),
      this.prisma.db.usageDay.findMany({
        where: { userId, day: { gte: monthStart() } },
        orderBy: [{ day: 'asc' }, { kind: 'asc' }],
      }),
    ]);
    const counted = rows.filter((row) => !freeKinds.includes(row.kind));
    const used = round(counted.reduce((sum, row) => sum + row.costUsd, 0));
    return {
      ...limit,
      usedUsd: used,
      remainingUsd: round(Math.max(0, limit.monthlyLimitUsd - used)),
      calls: counted.reduce((sum, row) => sum + row.calls, 0),
      inputTokens: counted.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: counted.reduce((sum, row) => sum + row.outputTokens, 0),
      renewsAt: nextMonthStart(),
      days: counted.map((row) => ({
        day: row.day.toISOString().slice(0, 10),
        kind: row.kind,
        calls: row.calls,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costUsd: round(row.costUsd),
      })),
    };
  }

  private async usedThisMonth(userId: string): Promise<number> {
    const result = await this.prisma.db.usageDay.aggregate({
      where: {
        userId,
        day: { gte: monthStart() },
        kind: { notIn: freeKinds },
      },
      _sum: { costUsd: true },
    });
    return result._sum.costUsd ?? 0;
  }

  private async limitFor(userId: string) {
    const plan = await this.prisma.db.billingPlan.findUnique({
      where: { userId },
    });
    return this.limitOf(plan);
  }

  private limitOf(
    plan: { plan: string; monthlyLimitUsd: number | null } | null | undefined,
  ): { plan: string; monthlyLimitUsd: number } {
    const name = (
      plan?.plan && plan.plan in billingPlans ? plan.plan : 'free'
    ) as BillingPlanName;
    return {
      plan: name,
      monthlyLimitUsd:
        plan?.monthlyLimitUsd ?? billingPlans[name].monthlyLimitUsd,
    };
  }

  private async userExists(userId: string): Promise<void> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found.');
  }

  private staff(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    permission: 'read' | 'update',
  ): Promise<void> {
    return assertStaff(
      { betterAuth: this.betterAuth, prisma: this.prisma },
      auth,
      headers,
      { usage: [permission] },
    );
  }
}
