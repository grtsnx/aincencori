import { ConfigService } from '@nestjs/config';
import {
  currencyFor,
  hireMonthDays,
  marketplaceFeePercent,
  priceIn,
} from '@/config/billing/plans.js';
import { BachsService } from '@/lib/bachs/bachs.service.js';
import { reportProblem } from '@/middleware';
import { ActivityService } from '../activity/activity.service.js';
import { NotificationService } from '../notification/notification.service.js';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  createReviewAgent,
  type ListingReview,
  secretLike,
} from '@/config/agents/agents.js';
import {
  deleteCencoriSessionJob,
  reviewListingJob,
} from '@/config/agents/jobs.js';
import { maxListingsPerUser } from '@/config/agents/limits.js';
import type {
  BotDto,
  BrowseListingsQueryDto,
  EarningsDto,
  HireBotDto,
  HireCheckoutDto,
  HireDto,
  ListingDto,
  OwnListingDto,
  PayoutStatusDto,
  PublishBotDto,
  ReviewListingsQueryDto,
  StartPayoutsDto,
} from '@/dto';
import { type Listing, Prisma } from '@/generated/prisma/client.js';
import {
  type AuthSession,
  BetterAuthService,
} from '@/lib/better-auth/better-auth.service.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { CencoriService } from '@/lib/cencori/cencori.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { assertStaff } from '@/middleware';
import { serializableTransaction } from '@/middleware';
import { BotService } from '../bot/bot.service.js';

interface Owner {
  user: { id: string };
}

type ListingSkill = { name: string; description: string; instructions: string };

// Tries the safety review gets before it is left to staff.
const reviewAttempts = 3;

// The marketplace: users share their bots, others copy them.
// - Publishing saves a copy of the bot (name, description, instructions,
//   skills). Memories, integrations, documents and sign-ins are never shared.
// - Each copy gets a safety review in the background before anyone sees it.
//   Staff with the marketplace permission can approve or reject by hand.
// - Copying ("import") makes a new bot for the user from the shared copy.
@Injectable()
export class MarketplaceService implements OnModuleInit {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bullmq: BullmqService,
    private readonly cencori: CencoriService,
    private readonly betterAuth: BetterAuthService,
    private readonly bots: BotService,
    private readonly bachs: BachsService,
    private readonly config: ConfigService,
    private readonly activity: ActivityService,
    private readonly notifications?: NotificationService,
  ) {}

  onModuleInit(): void {
    this.bullmq.handle<{ listingId: string }>(
      reviewListingJob,
      ({ listingId }, { attempt }) => this.review(listingId, attempt),
    );
  }

  // Published bots, for everyone (signed in or not).
  async browse(query: BrowseListingsQueryDto): Promise<ListingDto[]> {
    const words = query.q?.trim();
    const listings = await this.prisma.db.listing.findMany({
      where: {
        status: 'published',
        ...(query.category && { category: query.category }),
        ...(words && {
          OR: [
            { name: { contains: words, mode: 'insensitive' } },
            { description: { contains: words, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy:
        query.sort === 'newest'
          ? [{ publishedAt: 'desc' }, { id: 'desc' }]
          : [{ importCount: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
      skip: query.offset ?? 0,
      take: query.limit ?? 24,
    });
    return listings.map((listing) => toDto(listing));
  }

  // One published bot. Its author also sees it while it is reviewed.
  async get(
    id: string,
    auth: AuthSession | null,
  ): Promise<ListingDto | OwnListingDto> {
    const listing = await this.prisma.db.listing.findUnique({ where: { id } });
    if (listing && auth?.user.id === listing.userId) return toOwnDto(listing);
    if (!listing || listing.status !== 'published') {
      throw new NotFoundException('Bot not found on the marketplace.');
    }
    return toDto(listing);
  }

  async mine(auth: Owner): Promise<OwnListingDto[]> {
    const listings = await this.prisma.db.listing.findMany({
      where: { userId: auth.user.id },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return listings.map(toOwnDto);
  }

  // Shares a bot, or shares its latest version. Either way it is reviewed
  // again and hidden until it passes.
  async publish(auth: Owner, body: PublishBotDto): Promise<OwnListingDto> {
    const userId = auth.user.id;
    const db = this.prisma.db;
    const bot = await db.bot.findFirst({
      where: { id: body.botId, userId },
      include: { skills: { orderBy: { createdAt: 'asc' } } },
    });
    if (!bot) throw new NotFoundException('Bot not found.');
    if (!bot.description?.trim()) {
      throw new BadRequestException(
        'Add a description to the bot first, so people know what it does.',
      );
    }
    const defaultAuthorName =
      (await db.user.findUnique({ where: { id: userId } }))?.name ?? 'Someone';
    const copy = {
      name: bot.name,
      description: bot.description,
      instructions: bot.instructions,
      skills: bot.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
      })),
      category: body.category,
      priceType: body.priceType ?? 'free',
      priceUsd: (body.priceType ?? 'free') === 'free' ? null : body.priceUsd!,
      status: 'reviewing',
      reviewNote: null,
    };
    // Selling needs somewhere to be paid. It can still be reviewed while
    // Bachs checks the creator; hiring opens once payouts are on.
    if (copy.priceType !== 'free') {
      const creator = await db.creatorAccount.findUnique({ where: { userId } });
      if (!creator) {
        throw new BadRequestException(
          'Set up payouts first (POST /v1/marketplace/payouts), so you can be paid.',
        );
      }
    }
    const listing = await serializableTransaction(db, async (tx) => {
      const existing = await tx.listing.findUnique({
        where: { botId: bot.id },
      });
      if (
        !existing &&
        (await tx.listing.count({ where: { userId } })) >= maxListingsPerUser
      ) {
        throw new BadRequestException(
          `You can share up to ${maxListingsPerUser} bots.`,
        );
      }
      const authorName =
        body.authorName ?? existing?.authorName ?? defaultAuthorName;
      return tx.listing.upsert({
        where: { botId: bot.id },
        create: {
          id: randomUUID(),
          botId: bot.id,
          userId,
          authorName,
          ...copy,
        },
        update: { authorName, ...copy },
      });
    });
    await this.bullmq.add(
      reviewListingJob,
      { listingId: listing.id },
      { attempts: reviewAttempts },
    );
    return toOwnDto(
      (await db.listing.findUnique({ where: { id: listing.id } })) ?? listing,
    );
  }

  // Takes a bot off the marketplace. Copies people made are theirs to keep.
  async unpublish(id: string, auth: Owner): Promise<void> {
    const { count } = await this.prisma.db.listing.deleteMany({
      where: { id, userId: auth.user.id },
    });
    if (count === 0)
      throw new NotFoundException('Bot not found on the marketplace.');
  }

  // Makes the user their own copy of a published bot.
  async import(id: string, auth: Owner): Promise<BotDto> {
    const db = this.prisma.db;
    const listing = await db.listing.findUnique({ where: { id } });
    if (!listing || listing.status !== 'published') {
      throw new NotFoundException('Bot not found on the marketplace.');
    }
    if (listing.priceType !== 'free') {
      throw new HttpException(
        'This bot is paid: hire it to get your copy.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    const bot = await this.bots.createCopy(auth.user.id, {
      name: listing.name,
      description: listing.description,
      instructions: listing.instructions,
      skills: skillsOf(listing),
    });
    await db.listing.update({
      where: { id },
      data: { importCount: { increment: 1 } },
    });
    return bot;
  }

  // ── Paid bots ─────────────────────────────────────────────────────────

  // Where the creator stands with payouts, with a fresh setup link while
  // Bachs still needs something from them.
  async payoutStatus(auth: Owner): Promise<PayoutStatusDto> {
    const creator = await this.prisma.db.creatorAccount.findUnique({
      where: { userId: auth.user.id },
    });
    if (!creator) {
      return {
        connected: false,
        payoutsActive: false,
        setupUrl: null,
        feePercent: marketplaceFeePercent,
      };
    }
    const payoutsActive = await this.refreshCreator(creator.bachsAccountId);
    return {
      connected: true,
      payoutsActive,
      setupUrl: payoutsActive
        ? null
        : await this.bachs.creatorOnboardingLink(
            creator.bachsAccountId,
            this.payoutUrls(),
          ),
      feePercent: marketplaceFeePercent,
    };
  }

  // Starts payout setup: the creator's account at Bachs, and the page where
  // they prove who they are and say where to be paid.
  async startPayouts(
    auth: Owner & { user: { email: string; name: string } },
    body: StartPayoutsDto,
  ): Promise<PayoutStatusDto> {
    const userId = auth.user.id;
    const db = this.prisma.db;
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`WITH lock AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtextextended(${`creator-account:${userId}`}, 0))) SELECT 1 FROM lock`;
        const existing = await tx.creatorAccount.findUnique({
          where: { userId },
        });
        if (existing) return;
        const accountId = await this.bachs.createCreatorAccount({
          email: auth.user.email,
          name: auth.user.name || auth.user.email,
          country: body.country.toUpperCase(),
          userId,
        });
        await tx.creatorAccount.create({
          data: {
            userId,
            bachsAccountId: accountId,
            country: body.country.toUpperCase(),
          },
        });
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    return this.payoutStatus(auth);
  }

  // Asks Bachs whether the creator can be paid yet, and keeps the answer.
  async refreshCreator(
    accountId: string,
    tx: Prisma.TransactionClient = this.prisma.db,
  ): Promise<boolean> {
    const before = await tx.creatorAccount.findUnique({
      where: { bachsAccountId: accountId },
      select: { userId: true, payoutsActive: true },
    });
    const payoutsActive = await this.bachs
      .creatorCanBePaid(accountId)
      .catch((error: unknown) => {
        reportProblem('bachs', 'Checking a creator at Bachs failed', error);
        return false;
      });
    await tx.creatorAccount.updateMany({
      where: { bachsAccountId: accountId },
      data: { payoutsActive },
    });
    if (before && !before.payoutsActive && payoutsActive) {
      this.notifications?.notify(before.userId, 'marketplace', {
        title: 'Payouts are on',
        body: 'Bachs checked your details. People can now hire your paid bots.',
        link: '/marketplace/payouts',
      });
    }
    return payoutsActive;
  }

  // Hires a paid bot: a checkout where the buyer pays us, and Bachs sends
  // the creator their share. The bot is the buyer's once Bachs confirms.
  async hire(
    id: string,
    auth: Owner & { user: { email: string; name: string } },
    headers: IncomingHttpHeaders,
    body: HireBotDto,
  ): Promise<HireCheckoutDto> {
    const db = this.prisma.db;
    const listing = await db.listing.findUnique({ where: { id } });
    if (!listing || listing.status !== 'published') {
      throw new NotFoundException('Bot not found on the marketplace.');
    }
    if (listing.priceType === 'free' || !listing.priceUsd) {
      throw new BadRequestException('This bot is free: copy it instead.');
    }
    if (listing.userId === auth.user.id) {
      throw new BadRequestException('This is your own bot.');
    }
    const creator = await db.creatorAccount.findUnique({
      where: { userId: listing.userId },
    });
    if (!creator?.payoutsActive) {
      throw new ConflictException(
        'This bot cannot be hired yet: its creator is still setting up payouts.',
      );
    }
    if (listing.priceType === 'one_off') {
      const owned = await db.hire.findFirst({
        where: { listingId: id, buyerId: auth.user.id },
      });
      if (owned) throw new ConflictException('You already own this bot.');
    }
    const currency = currencyFor(headers, body.currency);
    const price = priceIn(listing.priceUsd, currency);
    const fee = Math.round(price * marketplaceFeePercent) / 100;
    const app = this.config.getOrThrow<string>('APP_URL');
    const checkout = await this.bachs.splitCheckout(
      {
        currency,
        amount: price.toFixed(2),
        platformFee: fee.toFixed(2),
        destination: creator.bachsAccountId,
        customer: {
          email: auth.user.email,
          name: auth.user.name || auth.user.email,
        },
        paymentMethods:
          currency === 'USD' ? ['USD_CARD'] : ['NGN_CARD', 'NGN_BANK_TRANSFER'],
        metadata: { userId: auth.user.id, kind: 'hire', listingId: id },
        successUrl: `${app}/marketplace/${id}?hired=1`,
        cancelUrl: `${app}/marketplace/${id}?hired=0`,
      },
      randomUUID(),
    );
    return {
      url: checkout.url,
      expiresAt: checkout.expiresAt,
      price,
      currency,
    };
  }

  // Bachs confirmed a hire was paid (from the payments webhook). Gives the
  // buyer their copy, or another month on the copy they have. Each checkout
  // counts once.
  async completeHire(
    data: Record<string, unknown>,
    tx: Prisma.TransactionClient = this.prisma.db,
  ): Promise<{
    userId: string;
    detail: string;
    activityAction: string;
    activityUserId: string;
    activityTarget: string;
  } | null> {
    if (data.payment_status !== 'paid') return null;
    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    const checkoutId =
      typeof data.checkout_id === 'string' ? data.checkout_id : null;
    const buyerId = typeof meta.userId === 'string' ? meta.userId : null;
    const listingId =
      typeof meta.listingId === 'string' ? meta.listingId : null;
    if (!checkoutId || !buyerId || !listingId) return null;
    const db = tx;
    await db.$queryRaw`WITH lock AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtextextended(${`marketplace-checkout:${checkoutId}`}, 0))) SELECT 1 FROM lock`;
    if (await db.hire.findUnique({ where: { checkoutId } })) return null;
    const [listing, buyer] = await Promise.all([
      db.listing.findUnique({ where: { id: listingId } }),
      db.user.findUnique({ where: { id: buyerId }, select: { id: true } }),
    ]);
    if (!listing || !buyer) return null;

    await db.$queryRaw`WITH lock AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtextextended(${`marketplace-buyer:${buyerId}:${listingId}`}, 0))) SELECT 1 FROM lock`;
    const monthly = listing.priceType === 'monthly';
    // The buyer's copy from an earlier hire, if they still have it.
    const earlier = await db.bot.findFirst({
      where: { userId: buyerId, hiredListingId: listingId },
    });
    const now = Date.now();
    const from =
      monthly && earlier?.hiredUntil && earlier.hiredUntil.getTime() > now
        ? earlier.hiredUntil.getTime()
        : now;
    const paidUntil = monthly
      ? new Date(from + hireMonthDays * 24 * 60 * 60_000)
      : null;
    const botId =
      earlier?.id ??
      (
        await this.bots.createCopy(
          buyerId,
          {
            name: listing.name,
            description: listing.description,
            instructions: listing.instructions,
            skills: skillsOf(listing),
          },
          tx,
        )
      ).id;
    await db.bot.update({
      where: { id: botId },
      data: { hiredListingId: listingId, hiredUntil: paidUntil },
    });
    const amount =
      typeof data.amount === 'string' ? data.amount : String(data.amount ?? '');
    const currency = typeof data.currency === 'string' ? data.currency : '';
    const platformFee = (
      (Number(amount) * marketplaceFeePercent) /
      100
    ).toFixed(2);
    await db.hire.create({
      data: {
        id: randomUUID(),
        listingId,
        buyerId,
        creatorId: listing.userId,
        kind: listing.priceType,
        botId,
        amount,
        currency,
        platformFee,
        checkoutId,
        paidUntil,
      },
    });
    if (!earlier) {
      await db.listing.update({
        where: { id: listingId },
        data: { hireCount: { increment: 1 } },
      });
    }
    return {
      userId: buyerId,
      detail: `Hired ${listing.name}${paidUntil ? ` until ${paidUntil.toISOString().slice(0, 10)}` : ''}`,
      activityAction: 'marketplace.sold',
      activityUserId: listing.userId,
      activityTarget: listing.name,
    };
  }

  // What a creator has sold, and their share.
  async earnings(auth: Owner): Promise<EarningsDto> {
    const sales = await this.prisma.db.hire.findMany({
      where: { creatorId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const totals = new Map<
      string,
      { sales: number; gross: number; fee: number }
    >();
    for (const sale of sales) {
      const total = totals.get(sale.currency) ?? { sales: 0, gross: 0, fee: 0 };
      total.sales += 1;
      total.gross += Number(sale.amount);
      total.fee += Number(sale.platformFee);
      totals.set(sale.currency, total);
    }
    return {
      totals: [...totals.entries()].map(([currency, total]) => ({
        currency,
        sales: total.sales,
        gross: total.gross.toFixed(2),
        yours: (total.gross - total.fee).toFixed(2),
      })),
      sales: await this.withNames(sales.slice(0, 50)),
    };
  }

  // The bots the user hired, newest first.
  async hires(auth: Owner): Promise<HireDto[]> {
    const hires = await this.prisma.db.hire.findMany({
      where: { buyerId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return this.withNames(hires);
  }

  private async withNames(
    hires: {
      id: string;
      listingId: string;
      kind: string;
      amount: string;
      currency: string;
      platformFee: string;
      botId: string | null;
      paidUntil: Date | null;
      createdAt: Date;
    }[],
  ): Promise<HireDto[]> {
    const listings = await this.prisma.db.listing.findMany({
      where: { id: { in: [...new Set(hires.map((hire) => hire.listingId))] } },
      select: { id: true, name: true },
    });
    return hires.map((hire) => ({
      id: hire.id,
      listingId: hire.listingId,
      name:
        listings.find((listing) => listing.id === hire.listingId)?.name ??
        'Removed bot',
      kind: hire.kind,
      amount: hire.amount,
      currency: hire.currency,
      platformFee: hire.platformFee,
      botId: hire.botId,
      paidUntil: hire.paidUntil,
      createdAt: hire.createdAt,
    }));
  }

  private payoutUrls() {
    const app = this.config.getOrThrow<string>('APP_URL');
    return {
      returnUrl: `${app}/marketplace/payouts?done=1`,
      refreshUrl: `${app}/marketplace/payouts?again=1`,
    };
  }

  // ── Staff ────────────────────────────────────────────────────────────

  async reviewList(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    query: ReviewListingsQueryDto,
  ): Promise<OwnListingDto[]> {
    await this.authorizeStaff(auth, headers);
    const listings = await this.prisma.db.listing.findMany({
      where: { status: query.status ?? 'reviewing' },
      // Oldest first: the ones waiting longest.
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
    return listings.map(toOwnDto);
  }

  async approve(
    id: string,
    auth: AuthSession,
    headers: IncomingHttpHeaders,
  ): Promise<OwnListingDto> {
    await this.authorizeStaff(auth, headers);
    return this.decide(id, { status: 'published', reviewNote: null });
  }

  async reject(
    id: string,
    reason: string,
    auth: AuthSession,
    headers: IncomingHttpHeaders,
  ): Promise<OwnListingDto> {
    await this.authorizeStaff(auth, headers);
    return this.decide(id, { status: 'rejected', reviewNote: reason });
  }

  private async decide(
    id: string,
    decision: { status: string; reviewNote: string | null },
  ): Promise<OwnListingDto> {
    try {
      const listing = await this.prisma.db.listing.update({
        where: { id },
        data: {
          ...decision,
          ...(decision.status === 'published' && { publishedAt: new Date() }),
        },
      });
      return toOwnDto(listing);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Bot not found on the marketplace.');
      }
      throw error;
    }
  }

  private authorizeStaff(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
  ): Promise<void> {
    return assertStaff(
      { betterAuth: this.betterAuth, prisma: this.prisma },
      auth,
      headers,
      { marketplace: ['review'] },
    );
  }

  // ── Safety review (worker) ───────────────────────────────────────────

  private async review(listingId: string, attempt: number): Promise<void> {
    const db = this.prisma.db;
    const listing = await db.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status !== 'reviewing') return;
    const skills = skillsOf(listing);
    const parts = [
      listing.name,
      listing.description,
      listing.instructions,
      ...skills.flatMap((skill) => [
        skill.name,
        skill.description,
        skill.instructions,
      ]),
    ];

    let verdict: ListingReview;
    if (parts.some((part) => secretLike.test(part))) {
      verdict = {
        safe: false,
        reason:
          'It seems to contain a key or password. Remove it, then publish again.',
      };
    } else if (!this.cencori.isConfigured) {
      // No reviewer: staff decide.
      return;
    } else {
      try {
        const result = await this.cencori.agentRun(
          createReviewAgent(),
          JSON.stringify({
            name: listing.name,
            description: listing.description,
            instructions: listing.instructions,
            skills,
          }),
          {
            user: listing.userId,
            metadata: { userId: listing.userId, listingId },
            maxTurns: 2,
          },
        );
        await this.bullmq
          .add(deleteCencoriSessionJob, { sessionId: result.sessionId })
          .catch(() => undefined);
        const output = result.finalOutput as ListingReview | undefined;
        if (!output) throw new Error('The reviewer gave no answer.');
        verdict = output;
      } catch (error) {
        if (attempt < reviewAttempts) throw error;
        // Left for staff to decide.
        this.logger.warn(`Listing ${listingId} could not be reviewed.`);
        return;
      }
    }

    // Only if nobody published a newer version meanwhile.
    await db.listing.updateMany({
      where: {
        id: listingId,
        status: 'reviewing',
        updatedAt: listing.updatedAt,
      },
      data: verdict.safe
        ? { status: 'published', reviewNote: null, publishedAt: new Date() }
        : {
            status: 'rejected',
            reviewNote:
              verdict.reason.trim() || 'It did not pass the safety review.',
          },
    });
  }
}

function skillsOf(listing: Listing): ListingSkill[] {
  return Array.isArray(listing.skills)
    ? (listing.skills as unknown as ListingSkill[])
    : [];
}

// A listing as shown. A paid bot's instructions and skill steps stay hidden
// until it is hired (its author always sees them).
function toDto(listing: Listing, unlocked = false): ListingDto {
  const locked = listing.priceType !== 'free' && !unlocked;
  return {
    id: listing.id,
    name: listing.name,
    description: listing.description,
    category: listing.category,
    authorName: listing.authorName,
    instructions: locked ? '' : listing.instructions,
    skills: skillsOf(listing).map((skill) =>
      locked ? { ...skill, instructions: '' } : skill,
    ),
    importCount: listing.importCount,
    priceType: listing.priceType,
    priceUsd: listing.priceUsd,
    hireCount: listing.hireCount,
    locked,
    publishedAt: listing.publishedAt,
  };
}

function toOwnDto(listing: Listing): OwnListingDto {
  return {
    ...toDto(listing, true),
    botId: listing.botId,
    status: listing.status,
    reviewNote: listing.reviewNote,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
}
