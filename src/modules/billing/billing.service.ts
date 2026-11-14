import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingHttpHeaders } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  type BillingCurrency,
  type BillingPlanName,
  billingPlanNames,
  billingPlans,
  creditPackNames,
  creditPacks,
  type CreditPackName,
  ngnCountries,
  paidPlanNames,
  prepaidDays,
  priceIn,
  trialDays,
} from '@/config/billing/plans.js';
import type {
  BillingOverviewDto,
  GiveCreditsDto,
  StaffCancelDto,
  UserBillingDto,
  BillingDto,
  BuyCreditsDto,
  CheckoutDto,
  PortalDto,
  PriceListDto,
  StartCheckoutDto,
  StartTrialDto,
} from '@/dto';
import { cancelSubscriptionJob } from '@/config/agents/jobs.js';
import { BachsService } from '@/lib/bachs/bachs.service.js';
import {
  type AuthSession,
  BetterAuthService,
} from '@/lib/better-auth/better-auth.service.js';
import { assertStaff } from '@/middleware';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { effectivePlan, UsageService } from '../usage/usage.service.js';

type Owner = { user: { id: string; email: string; name: string } };

const dayMs = 24 * 60 * 60_000;

// The currency to show: the one asked for, else naira for people in Nigeria
// (from the country header our host or CDN adds), else dollars.
export function currencyFor(
  headers: IncomingHttpHeaders,
  asked?: BillingCurrency,
): BillingCurrency {
  if (asked) return asked;
  const country = [
    headers['cf-ipcountry'],
    headers['x-vercel-ip-country'],
    headers['x-country-code'],
  ]
    .flat()
    .find((value): value is string => typeof value === 'string');
  return country && ngnCountries.includes(country.toUpperCase())
    ? 'NGN'
    : 'USD';
}

// Paying with Bachs: plans (three for individuals, three for businesses), a
// free trial, extra AI credits, and Bachs's customer portal. Dollar cards
// renew each month; naira pays one month at a time. Only Bachs's signed
// webhooks change what a user has paid for, never the return from checkout.
@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bachs: BachsService,
    private readonly usage: UsageService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
    private readonly bullmq: BullmqService,
    private readonly betterAuth: BetterAuthService,
  ) {}

  onModuleInit(): void {
    // A deleted account's card plan stops at once.
    this.bullmq.handle<{ subscriptionId: string }>(
      cancelSubscriptionJob,
      async ({ subscriptionId }) => {
        if (!this.bachs.isConfigured) return;
        await this.bachs.sdk.subscriptions
          .cancel(subscriptionId, { cancel_at_period_end: false })
          .catch((error: { statusCode?: number }) => {
            // Already canceled: nothing to do.
            if (error.statusCode !== 400) throw error;
          });
      },
    );
  }

  prices(headers: IncomingHttpHeaders, asked?: BillingCurrency): PriceListDto {
    const currency = currencyFor(headers, asked);
    return {
      currency,
      trialDays,
      plans: billingPlanNames.map((plan) => ({
        plan,
        name: billingPlans[plan].name,
        audience: billingPlans[plan].audience,
        price: priceIn(billingPlans[plan].priceUsd, currency),
        currency,
        monthlyLimitUsd: billingPlans[plan].monthlyLimitUsd,
        renews: currency === 'USD',
      })),
      creditPacks: creditPackNames.map((pack) => ({
        pack,
        price: priceIn(creditPacks[pack].priceUsd, currency),
        currency,
        creditUsd: creditPacks[pack].creditUsd,
      })),
    };
  }

  async mine(auth: { user: { id: string } }): Promise<BillingDto> {
    const row = await this.prisma.db.billingPlan.findUnique({
      where: { userId: auth.user.id },
    });
    const plan = effectivePlan(row);
    // A plan that has ended reads as Free.
    const live = row && plan === row.plan;
    return {
      plan,
      source: live ? row.source : 'free',
      status: live ? row.status : 'active',
      currency: row?.currency ?? null,
      paidUntil: live ? row.paidUntil : null,
      cancelAtPeriodEnd: live ? row.cancelAtPeriodEnd : false,
      trialAvailable: !row?.trialUsedAt,
      creditUsd: Math.round((row?.creditUsd ?? 0) * 100) / 100,
      hasPortal: Boolean(row?.bachsCustomerId),
    };
  }

  // A free trial of a paid plan: no card, once per account.
  async startTrial(auth: Owner, body: StartTrialDto): Promise<BillingDto> {
    const userId = auth.user.id;
    const row = await this.prisma.db.billingPlan.findUnique({
      where: { userId },
    });
    if (row?.trialUsedAt) {
      throw new ConflictException('You have already used your free trial.');
    }
    if (effectivePlan(row) !== 'free') {
      throw new ConflictException('You already have a paid plan.');
    }
    const now = new Date();
    const data = {
      plan: body.plan,
      source: 'trial',
      status: 'trialing',
      paidUntil: new Date(now.getTime() + trialDays * dayMs),
      cancelAtPeriodEnd: false,
      trialUsedAt: now,
      monthlyLimitUsd: null,
    };
    await this.prisma.db.billingPlan.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    await this.usage.syncPlan(userId, body.plan);
    return this.mine(auth);
  }

  // A checkout for a plan: dollars renew by card, naira pays one month.
  async checkout(
    auth: Owner,
    headers: IncomingHttpHeaders,
    body: StartCheckoutDto,
  ): Promise<CheckoutDto> {
    const userId = auth.user.id;
    const plan = body.plan as BillingPlanName;
    const currency = currencyFor(headers, body.currency);
    const row = await this.prisma.db.billingPlan.findUnique({
      where: { userId },
    });
    if (
      row?.source === 'subscription' &&
      row.bachsSubscriptionId &&
      effectivePlan(row) !== 'free'
    ) {
      throw new ConflictException(
        'You already pay by card. Change or cancel it in the customer portal.',
      );
    }
    const { name, priceUsd } = billingPlans[plan];
    const customer = this.customer(auth, row?.bachsCustomerId);
    if (currency === 'USD') {
      const productId = await this.bachs.planProduct(plan, name, priceUsd);
      return this.bachs.checkout(
        {
          product_cart: [{ product_id: productId }],
          customer,
          billing_currency: 'USD',
          payment_method_types: ['USD_CARD'],
          metadata: { userId, kind: 'subscription', plan },
          ...this.returnUrls('plan'),
        },
        randomUUID(),
      );
    }
    return this.bachs.checkout(
      {
        pricing: {
          currency: 'NGN',
          amount: priceIn(priceUsd, 'NGN').toFixed(2),
        },
        customer,
        billing_currency: 'NGN',
        payment_method_types: ['NGN_CARD', 'NGN_BANK_TRANSFER'],
        metadata: { userId, kind: 'prepaid', plan },
        ...this.returnUrls('plan'),
      },
      randomUUID(),
    );
  }

  // Extra AI credits, paid once, in dollars or naira.
  async buyCredits(
    auth: Owner,
    headers: IncomingHttpHeaders,
    body: BuyCreditsDto,
  ): Promise<CheckoutDto> {
    const userId = auth.user.id;
    const pack = body.pack as CreditPackName;
    const currency = currencyFor(headers, body.currency);
    const row = await this.prisma.db.billingPlan.findUnique({
      where: { userId },
    });
    return this.bachs.checkout(
      {
        pricing: {
          currency,
          amount: priceIn(creditPacks[pack].priceUsd, currency).toFixed(2),
        },
        customer: this.customer(auth, row?.bachsCustomerId),
        billing_currency: currency,
        payment_method_types:
          currency === 'USD' ? ['USD_CARD'] : ['NGN_CARD', 'NGN_BANK_TRANSFER'],
        metadata: { userId, kind: 'credits', pack },
        ...this.returnUrls('credits'),
      },
      randomUUID(),
    );
  }

  // Bachs's own page for the user's card, invoices and subscription.
  async portal(auth: { user: { id: string } }): Promise<PortalDto> {
    const row = await this.prisma.db.billingPlan.findUnique({
      where: { userId: auth.user.id },
    });
    if (!row?.bachsCustomerId) {
      throw new NotFoundException('You have not paid for anything yet.');
    }
    return { url: await this.bachs.portal(row.bachsCustomerId) };
  }

  // Stops a dollar card plan at the end of the paid month.
  async cancel(auth: { user: { id: string } }): Promise<BillingDto> {
    const userId = auth.user.id;
    const row = await this.prisma.db.billingPlan.findUnique({
      where: { userId },
    });
    if (!row?.bachsSubscriptionId || row.source !== 'subscription') {
      throw new BadRequestException(
        'Only a card plan renews; other plans simply end.',
      );
    }
    await this.bachs.cancelAtPeriodEnd(row.bachsSubscriptionId);
    await this.prisma.db.billingPlan.update({
      where: { userId },
      data: { cancelAtPeriodEnd: true },
    });
    return this.mine(auth);
  }

  // ── For staff ──────────────────────────────────────────────────────────

  // Plans now, how they are paid, what they bring in a month, and the
  // latest payments.
  async overview(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
  ): Promise<BillingOverviewDto> {
    await this.staff(auth, headers, 'read');
    const db = this.prisma.db;
    const [rows, credits, recentEvents] = await Promise.all([
      db.billingPlan.findMany({
        where: { plan: { not: 'free' } },
        select: {
          plan: true,
          source: true,
          status: true,
          paidUntil: true,
        },
      }),
      db.billingPlan.aggregate({ _sum: { creditUsd: true } }),
      db.billingEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const live = rows.filter((row) => effectivePlan(row) === row.plan);
    const count = (test: (row: (typeof live)[number]) => boolean) =>
      live.filter(test).length;
    const paying = live.filter(
      (row) => row.source === 'subscription' || row.source === 'prepaid',
    );
    return {
      plans: billingPlanNames
        .filter((plan) => plan !== 'free')
        .map((plan) => ({ plan, users: count((row) => row.plan === plan) })),
      trials: count((row) => row.source === 'trial'),
      cardPlans: count((row) => row.source === 'subscription'),
      prepaidPlans: count((row) => row.source === 'prepaid'),
      pastDue: count((row) => row.status === 'past_due'),
      monthlyRevenueUsd: paying.reduce(
        (sum, row) =>
          sum + (billingPlans[row.plan as BillingPlanName]?.priceUsd ?? 0),
        0,
      ),
      creditsLeftUsd: Math.round((credits._sum.creditUsd ?? 0) * 100) / 100,
      recentEvents,
    };
  }

  // One user's plan, credits and payments.
  async forUser(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    userId: string,
  ): Promise<UserBillingDto> {
    await this.staff(auth, headers, 'read');
    await this.userExists(userId);
    const [billing, events] = await Promise.all([
      this.mine({ user: { id: userId } }),
      this.prisma.db.billingEvent.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return { ...billing, events };
  }

  // Gives AI credits (a refund, a thank-you), or takes them back.
  async giveCredits(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    userId: string,
    body: GiveCreditsDto,
  ): Promise<UserBillingDto> {
    await this.staff(auth, headers, 'update');
    await this.userExists(userId);
    await this.prisma.db.billingPlan.upsert({
      where: { userId },
      create: { userId, creditUsd: Math.max(0, body.amountUsd) },
      update: { creditUsd: { increment: body.amountUsd } },
    });
    // Never below nothing.
    await this.prisma.db.billingPlan.updateMany({
      where: { userId, creditUsd: { lt: 0 } },
      data: { creditUsd: 0 },
    });
    this.activity.log({
      userId,
      actor: `staff:${auth.user.id}`,
      action: 'billing.credits.given',
      target: `$${body.amountUsd}`,
      detail: body.reason,
    });
    return this.forUser(auth, headers, userId);
  }

  // Lets a user have the free trial again.
  async resetTrial(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    userId: string,
  ): Promise<UserBillingDto> {
    await this.staff(auth, headers, 'update');
    await this.userExists(userId);
    await this.prisma.db.billingPlan.updateMany({
      where: { userId },
      data: { trialUsedAt: null },
    });
    return this.forUser(auth, headers, userId);
  }

  // Stops a user's card plan: at the end of the paid month, or now.
  async staffCancel(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    userId: string,
    body: StaffCancelDto,
  ): Promise<UserBillingDto> {
    await this.staff(auth, headers, 'update');
    await this.userExists(userId);
    const row = await this.prisma.db.billingPlan.findUnique({
      where: { userId },
    });
    if (!row?.bachsSubscriptionId || row.source !== 'subscription') {
      throw new BadRequestException('This user has no card plan.');
    }
    if (body.now) {
      await this.bachs.sdk.subscriptions.cancel(row.bachsSubscriptionId, {
        cancel_at_period_end: false,
      });
      await this.prisma.db.billingPlan.update({
        where: { userId },
        data: {
          plan: 'free',
          source: 'free',
          status: 'canceled',
          paidUntil: null,
          cancelAtPeriodEnd: false,
          bachsSubscriptionId: null,
        },
      });
      await this.usage.syncPlan(userId, 'free');
    } else {
      await this.bachs.cancelAtPeriodEnd(row.bachsSubscriptionId);
      await this.prisma.db.billingPlan.update({
        where: { userId },
        data: { cancelAtPeriodEnd: true },
      });
    }
    return this.forUser(auth, headers, userId);
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
      { billing: [permission] },
    );
  }

  private async userExists(userId: string): Promise<void> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found.');
  }

  // What Bachs tells us about payments. Each event is used once.
  async webhook(rawBody: unknown, headers: IncomingHttpHeaders): Promise<void> {
    const event =
      typeof rawBody === 'string'
        ? this.bachs.event(rawBody, headers as Record<string, string>)
        : null;
    if (!event) {
      this.logger.warn('A Bachs webhook was refused (bad signature).');
      throw new UnauthorizedException('Bad signature.');
    }
    const seen = await this.prisma.db.billingEvent.findUnique({
      where: { id: event.id },
    });
    if (seen) return;
    const result = await this.apply(event.type, event.data);
    // Saved after it is applied: if applying failed, Bachs sends it again.
    await this.prisma.db.billingEvent
      .create({
        data: {
          id: event.id,
          type: event.type,
          userId: result?.userId ?? null,
          detail: result?.detail ?? null,
        },
      })
      .catch(() => undefined);
    if (result) {
      this.activity.log({
        userId: result.userId,
        actor: 'bachs',
        action: `billing.${event.type}`,
        target: result.plan ?? null,
        detail: result.detail,
      });
      if (result.plan) await this.usage.syncPlan(result.userId, result.plan);
    }
  }

  // Changes what the user has, from one Bachs event.
  private async apply(
    type: string,
    data: Record<string, unknown>,
  ): Promise<{ userId: string; plan?: string; detail: string } | null> {
    if (type.startsWith('customer.subscription.')) {
      return this.subscriptionChanged(type, data);
    }
    if (type === 'checkout.completed') return this.checkoutCompleted(data);
    return null;
  }

  private async subscriptionChanged(
    type: string,
    data: Record<string, unknown>,
  ): Promise<{ userId: string; plan?: string; detail: string } | null> {
    const subscriptionId = text(data.subscription_id);
    if (!subscriptionId) return null;
    const customerId = text(
      (data.customer as Record<string, unknown> | undefined)?.customer_id,
    );
    const userId = await this.userFor(data.metadata, {
      subscriptionId,
      customerId,
    });
    if (!userId) return null;
    const productId = text(data.product_id);
    const plan = productId ? await this.bachs.planOf(productId) : null;
    if (!plan || !paidPlanNames.includes(plan as BillingPlanName)) return null;

    const status = text(data.status) ?? 'active';
    const ended =
      type === 'customer.subscription.deleted' ||
      ['canceled', 'unpaid', 'paused'].includes(status);
    const periodEnd = text(data.current_period_end);
    const fields = {
      bachsSubscriptionId: subscriptionId,
      ...(customerId && { bachsCustomerId: customerId }),
      currency: 'USD',
    };
    if (ended) {
      // Only the subscription the user has now can end their plan.
      const row = await this.prisma.db.billingPlan.findUnique({
        where: { userId },
      });
      if (
        row?.bachsSubscriptionId &&
        row.bachsSubscriptionId !== subscriptionId
      )
        return null;
      await this.save(userId, {
        ...fields,
        plan: 'free',
        source: 'free',
        status: 'canceled',
        paidUntil: null,
        cancelAtPeriodEnd: false,
        bachsSubscriptionId: null,
      });
      return { userId, plan: 'free', detail: `${plan} card plan ended` };
    }
    // A subscription belongs to one user: drop it from any other row.
    await this.prisma.db.billingPlan.updateMany({
      where: { bachsSubscriptionId: subscriptionId, userId: { not: userId } },
      data: { bachsSubscriptionId: null },
    });
    await this.save(userId, {
      ...fields,
      plan,
      source: 'subscription',
      status: status === 'past_due' ? 'past_due' : 'active',
      paidUntil: periodEnd ? new Date(periodEnd) : null,
      cancelAtPeriodEnd: data.cancel_at_period_end === true,
      monthlyLimitUsd: null,
    });
    return {
      userId,
      plan,
      detail: `${plan} by card, ${status}${periodEnd ? `, until ${periodEnd.slice(0, 10)}` : ''}`,
    };
  }

  private async checkoutCompleted(
    data: Record<string, unknown>,
  ): Promise<{ userId: string; plan?: string; detail: string } | null> {
    if (data.payment_status !== 'paid') return null;
    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    const userId = await this.userFor(meta, {});
    if (!userId) return null;
    const customerId = text(
      (data.customer as Record<string, unknown> | null | undefined)
        ?.customer_id ??
        (data.charge as Record<string, unknown> | null | undefined)
          ?.customer_id,
    );
    const customer = customerId ? { bachsCustomerId: customerId } : {};

    if (meta.kind === 'credits') {
      const pack = text(meta.pack) as CreditPackName | undefined;
      if (!pack || !(pack in creditPacks)) return null;
      const credit = creditPacks[pack].creditUsd;
      await this.prisma.db.billingPlan.upsert({
        where: { userId },
        create: { userId, creditUsd: credit, ...customer },
        update: { creditUsd: { increment: credit }, ...customer },
      });
      return { userId, detail: `$${credit} AI credits bought` };
    }

    if (meta.kind === 'prepaid') {
      const plan = text(meta.plan) as BillingPlanName | undefined;
      if (!plan || !paidPlanNames.includes(plan)) return null;
      const row = await this.prisma.db.billingPlan.findUnique({
        where: { userId },
      });
      // Paying again before the month ends adds a month on top.
      const now = Date.now();
      const from =
        row?.source === 'prepaid' &&
        row.plan === plan &&
        row.paidUntil &&
        row.paidUntil.getTime() > now
          ? row.paidUntil.getTime()
          : now;
      const paidUntil = new Date(from + prepaidDays * dayMs);
      await this.save(userId, {
        ...customer,
        plan,
        source: 'prepaid',
        status: 'active',
        currency: 'NGN',
        paidUntil,
        cancelAtPeriodEnd: false,
        monthlyLimitUsd: null,
      });
      return {
        userId,
        plan,
        detail: `${plan} paid in naira, until ${paidUntil.toISOString().slice(0, 10)}`,
      };
    }
    // A card subscription's checkout: the subscription events set the plan.
    if (customerId) await this.save(userId, customer);
    return null;
  }

  // Whose payment it is: the user id we put in the checkout, else the
  // subscription or customer we already know. Only real users count.
  private async userFor(
    metadata: unknown,
    known: { subscriptionId?: string; customerId?: string },
  ): Promise<string | null> {
    const fromMeta = text(
      (metadata as Record<string, unknown> | undefined)?.userId,
    );
    const db = this.prisma.db;
    if (fromMeta) {
      const user = await db.user.findUnique({
        where: { id: fromMeta },
        select: { id: true },
      });
      if (user) return user.id;
    }
    // The subscription says most; the customer only if it is not known yet.
    if (known.subscriptionId) {
      const row = await db.billingPlan.findUnique({
        where: { bachsSubscriptionId: known.subscriptionId },
        select: { userId: true },
      });
      if (row) return row.userId;
    }
    if (known.customerId) {
      const rows = await db.billingPlan.findMany({
        where: { bachsCustomerId: known.customerId },
        select: { userId: true },
        take: 2,
      });
      // Two users with one customer: unclear, so neither.
      if (rows.length === 1) return rows[0].userId;
    }
    return null;
  }

  private async save(
    userId: string,
    data: Parameters<PrismaService['db']['billingPlan']['update']>[0]['data'],
  ): Promise<void> {
    await this.prisma.db.billingPlan.upsert({
      where: { userId },
      create: { userId, ...(data as object) },
      update: data,
    });
  }

  private customer(auth: Owner, customerId?: string | null) {
    return customerId
      ? { customer_id: customerId }
      : { email: auth.user.email, name: auth.user.name || auth.user.email };
  }

  // Where Bachs sends the user after paying (the app's billing page).
  private returnUrls(what: 'plan' | 'credits') {
    const app = this.config.getOrThrow<string>('APP_URL');
    return {
      success_url: `${app}/billing?paid=${what}`,
      cancel_url: `${app}/billing?canceled=${what}`,
    };
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
