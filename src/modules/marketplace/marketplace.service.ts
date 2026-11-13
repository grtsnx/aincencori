import {
  BadRequestException,
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
  ListingDto,
  OwnListingDto,
  PublishBotDto,
  ReviewListingsQueryDto,
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
    return listings.map(toDto);
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
    const existing = await db.listing.findUnique({
      where: { botId: bot.id },
    });
    if (
      !existing &&
      (await db.listing.count({ where: { userId } })) >= maxListingsPerUser
    ) {
      throw new BadRequestException(
        `You can share up to ${maxListingsPerUser} bots.`,
      );
    }
    const authorName =
      body.authorName ??
      existing?.authorName ??
      (await db.user.findUnique({ where: { id: userId } }))?.name ??
      'Someone';
    const copy = {
      authorName,
      name: bot.name,
      description: bot.description,
      instructions: bot.instructions,
      skills: bot.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
      })),
      category: body.category,
      status: 'reviewing',
      reviewNote: null,
    };
    const listing = await db.listing.upsert({
      where: { botId: bot.id },
      create: { id: randomUUID(), botId: bot.id, userId, ...copy },
      update: copy,
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

function toDto(listing: Listing): ListingDto {
  return {
    id: listing.id,
    name: listing.name,
    description: listing.description,
    category: listing.category,
    authorName: listing.authorName,
    instructions: listing.instructions,
    skills: skillsOf(listing),
    importCount: listing.importCount,
    publishedAt: listing.publishedAt,
  };
}

function toOwnDto(listing: Listing): OwnListingDto {
  return {
    ...toDto(listing),
    botId: listing.botId,
    status: listing.status,
    reviewNote: listing.reviewNote,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
}
