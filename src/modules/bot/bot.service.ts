import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  createLearnerAgent,
  type Learned,
  secretLike,
} from '@/config/agents/agents.js';
import { untrusted } from '@/config/agents/policy.js';
import {
  deleteBotAgentJob,
  deleteCencoriSessionJob,
  learnFromChatJob,
} from '@/config/agents/jobs.js';
import {
  maxBotsForAssistant,
  maxBotsPerUser,
  maxMemoriesPerBot,
  maxPendingSuggestions,
  maxSkillsPerBot,
  memoriesInPrompt,
} from '@/config/agents/limits.js';
import type {
  BotDto,
  BotMemoryDto,
  BotSkillDto,
  BotSuggestionDto,
  CreateBotDto,
  CreateBotMemoryDto,
  CreateBotSkillDto,
  InstallSkillDto,
  ListBotsQueryDto,
  PreviewSkillImportDto,
  SkillImportPreviewDto,
  UpdateBotDto,
  UpdateBotSkillDto,
} from '@/dto';
import type {
  Bot,
  BotSkill,
  BotSuggestion,
  Integration,
} from '@/generated/prisma/client.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { CencoriService } from '@/lib/cencori/cencori.service.js';
import {
  assertPublicUrl,
  parseSkillFile,
  readRunState,
  safeFetch,
  signRunState,
  skillFileUrl,
} from '@/middleware';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { type BotRuntime, ChatService } from '../chat/chat.service.js';
import { DocumentService } from '../document/document.service.js';
import { IntegrationService } from '../integration/integration.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { UsageService } from '../usage/usage.service.js';

interface Owner {
  user: { id: string };
}

type BotWithIntegrations = Bot & {
  integrations: { integration: Integration }[];
  documents: { document: { id: string; name: string } }[];
};

// A bot with what it is linked to: integrations and documents.
const withIntegrations = {
  integrations: { include: { integration: true } },
  documents: {
    include: { document: { select: { id: true, name: true } } },
    orderBy: { document: { name: 'asc' } },
  },
} as const;

// Bots: a user gives a bot a name and instructions, then chats with it
// (POST /v1/chat with botId). Integrations are optional: a bot only uses the
// ones its owner picked, so "Sales Bot" can have the work Gmail and "Family
// Bot" the personal one.
@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cencori: CencoriService,
    private readonly bullmq: BullmqService,
    private readonly integrations: IntegrationService,
    private readonly chat: ChatService,
    private readonly documents: DocumentService,
    private readonly usage: UsageService,
    private readonly activity: ActivityService,
    private readonly config?: ConfigService,
  ) {}

  onModuleInit(): void {
    // The chat loads a user's bot through us.
    this.chat.useBots({
      one: (userId, botId) => this.runtime(userId, botId),
      forAssistant: (userId) => this.forAssistant(userId),
    });
    this.bullmq.handle<{ sessionId: string }>(
      learnFromChatJob,
      ({ sessionId }) => this.learn(sessionId),
    );
    this.bullmq.handle<{ agentId: string }>(
      deleteBotAgentJob,
      async ({ agentId }) => {
        if (!this.cencori.isConfigured) return;
        await this.cencori.agentsDelete(agentId);
      },
    );
  }

  async list(auth: Owner, query: ListBotsQueryDto): Promise<BotDto[]> {
    const bots = await this.prisma.db.bot.findMany({
      where: { userId: auth.user.id },
      include: withIntegrations,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
    return bots.map(toDto);
  }

  async get(id: string, auth: Owner): Promise<BotDto> {
    return toDto(await this.own(id, auth.user.id));
  }

  async create(auth: Owner, body: CreateBotDto): Promise<BotDto> {
    const userId = auth.user.id;
    const count = await this.prisma.db.bot.count({ where: { userId } });
    if (count >= maxBotsPerUser) {
      throw new BadRequestException(
        `You can have up to ${maxBotsPerUser} bots.`,
      );
    }
    const integrationIds = await this.checkIntegrations(
      userId,
      body.integrationIds ?? [],
    );
    const documentIds = await this.checkDocuments(
      userId,
      body.documentIds ?? [],
    );
    const bot = await this.prisma.db.bot.create({
      data: {
        id: randomUUID(),
        userId,
        name: body.name,
        description: body.description,
        instructions: body.instructions,
        enabled: body.enabled ?? true,
        integrations: {
          create: integrationIds.map((integrationId) => ({ integrationId })),
        },
        documents: {
          create: documentIds.map((documentId) => ({ documentId })),
        },
      },
      include: withIntegrations,
    });
    return toDto(bot);
  }

  // A new bot copied from one shared on the marketplace: name, description,
  // instructions and skills. Never memories, integrations or documents.
  async createCopy(
    userId: string,
    copy: {
      name: string;
      description: string;
      instructions: string;
      skills: { name: string; description: string; instructions: string }[];
    },
  ): Promise<BotDto> {
    const count = await this.prisma.db.bot.count({ where: { userId } });
    if (count >= maxBotsPerUser) {
      throw new BadRequestException(
        `You can have up to ${maxBotsPerUser} bots.`,
      );
    }
    const bot = await this.prisma.db.bot.create({
      data: {
        id: randomUUID(),
        userId,
        name: copy.name,
        description: copy.description,
        instructions: copy.instructions,
        skills: {
          create: copy.skills.slice(0, maxSkillsPerBot).map((skill) => ({
            id: randomUUID(),
            ...skill,
          })),
        },
      },
      include: withIntegrations,
    });
    return toDto(bot);
  }

  async update(id: string, auth: Owner, body: UpdateBotDto): Promise<BotDto> {
    const current = await this.own(id, auth.user.id);
    const { integrationIds, documentIds, ...rest } = body;
    const picked =
      integrationIds === undefined
        ? undefined
        : await this.checkIntegrations(auth.user.id, integrationIds);
    const pickedDocuments =
      documentIds === undefined
        ? undefined
        : await this.checkDocuments(auth.user.id, documentIds);
    const bot = await this.prisma.db.bot.update({
      where: { id },
      data: {
        ...rest,
        ...(picked && {
          integrations: {
            deleteMany: {},
            create: picked.map((integrationId) => ({ integrationId })),
          },
        }),
        ...(pickedDocuments && {
          documents: {
            deleteMany: {},
            create: pickedDocuments.map((documentId) => ({ documentId })),
          },
        }),
      },
      include: withIntegrations,
    });
    // Keep the copy at Cencori (if there is one) in line.
    if (
      current.cencoriAgentId &&
      (body.name !== undefined || body.instructions !== undefined)
    ) {
      await this.cencori
        .agentsUpdateConfig(current.cencoriAgentId, {
          name: bot.name,
          config: { system_prompt: bot.instructions },
        })
        .catch(() => this.logger.warn(`Bot ${id} was not updated at Cencori.`));
    }
    return toDto(bot);
  }

  async remove(id: string, auth: Owner): Promise<void> {
    const bot = await this.own(id, auth.user.id);
    await this.prisma.db.bot.delete({ where: { id } });
    if (bot.installationId) {
      await this.cencori
        .installationsRemove(bot.installationId)
        .catch(() => undefined);
    }
    if (bot.cencoriAgentId) {
      await this.bullmq.add(deleteBotAgentJob, { agentId: bot.cencoriAgentId });
    }
  }

  // ── Memories: facts the bot already knows ────────────────────────────

  async memories(
    botId: string,
    auth: Owner,
    query: ListBotsQueryDto,
  ): Promise<BotMemoryDto[]> {
    await this.own(botId, auth.user.id);
    return this.prisma.db.botMemory.findMany({
      where: { botId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
      select: { id: true, text: true, createdAt: true },
    });
  }

  async addMemory(
    botId: string,
    auth: Owner,
    body: CreateBotMemoryDto,
  ): Promise<BotMemoryDto> {
    await this.own(botId, auth.user.id);
    return this.remember(botId, body.text);
  }

  async removeMemory(
    botId: string,
    memoryId: string,
    auth: Owner,
  ): Promise<void> {
    await this.own(botId, auth.user.id);
    const { count } = await this.prisma.db.botMemory.deleteMany({
      where: { id: memoryId, botId },
    });
    if (count === 0) throw new NotFoundException('Memory not found.');
  }

  // Saves a fact. When the bot is full, the oldest fact makes room. A fact
  // it already has is not saved twice.
  private async remember(botId: string, text: string): Promise<BotMemoryDto> {
    const db = this.prisma.db;
    const same = await db.botMemory.findFirst({
      where: { botId, text: { equals: text.trim(), mode: 'insensitive' } },
      select: { id: true, text: true, createdAt: true },
    });
    if (same) return same;
    const memory = await db.botMemory.create({
      data: { id: randomUUID(), botId, text },
      select: { id: true, text: true, createdAt: true },
    });
    const extra = await db.botMemory.findMany({
      where: { botId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: maxMemoriesPerBot,
      select: { id: true },
    });
    if (extra.length > 0) {
      await db.botMemory.deleteMany({
        where: { id: { in: extra.map((old) => old.id) } },
      });
    }
    return memory;
  }

  // ── Learning: the bot keeps what it learns and suggests changes ─────

  // Reads a bot chat's new messages after it goes quiet. Lasting facts (who
  // the team is, how it works) become memories at once; changes to the bot
  // itself wait as suggestions until the user accepts them.
  private async learn(sessionId: string): Promise<void> {
    if (!this.cencori.isConfigured) return;
    const db = this.prisma.db;
    const chat = await db.chatSession.findUnique({ where: { id: sessionId } });
    if (!chat?.botId || chat.groupId) return;
    const bot = await db.bot.findFirst({
      where: { id: chat.botId, userId: chat.userId },
    });
    if (!bot) return;
    const messages = await db.chatMessage.findMany({
      where: {
        sessionId,
        ...(chat.learnedAt && { createdAt: { gt: chat.learnedAt } }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 60,
      include: { reactions: { select: { emoji: true } } },
    });
    if (!messages.some((message) => message.role === 'user')) return;
    // Out of allowance: it learns later, once there is some again.
    try {
      await this.usage.assertAllowance(chat.userId);
    } catch {
      return;
    }
    const [memories, skills, pending] = await Promise.all([
      db.botMemory.findMany({
        where: { botId: bot.id },
        orderBy: { createdAt: 'desc' },
        take: memoriesInPrompt,
        select: { text: true },
      }),
      db.botSkill.findMany({
        where: { botId: bot.id },
        select: { name: true, description: true },
      }),
      db.botSuggestion.count({ where: { botId: bot.id, status: 'pending' } }),
    ]);
    const transcript = messages
      .map((message) => {
        const who =
          message.role === 'user'
            ? 'User'
            : message.role === 'human'
              ? 'Our team'
              : 'Bot';
        const reacted = message.reactions.length
          ? ` [the user reacted ${message.reactions.map((r) => r.emoji).join(' ')}]`
          : '';
        return `${who}: ${message.text.slice(0, 2000)}${reacted}`;
      })
      .join('\n');
    const result = await this.cencori.agentRun(
      createLearnerAgent(),
      [
        `Bot: ${untrusted('bot name', bot.name)}`,
        `Instructions:\n${untrusted('bot instructions', bot.instructions)}`,
        `Memories:\n${memories.map((m) => untrusted('bot memory', m.text)).join('\n') || '(none)'}`,
        `Skills:\n${skills.map((k) => untrusted('bot skill', `${k.name}: ${k.description}`)).join('\n') || '(none)'}`,
        `Chat:\n${untrusted('chat transcript', transcript)}`,
      ].join('\n\n'),
      {
        user: chat.userId,
        metadata: { userId: chat.userId, botId: bot.id, kind: 'learning' },
        maxTurns: 2,
      },
    );
    // The learner's own little chat is not kept.
    await this.bullmq
      .add(deleteCencoriSessionJob, { sessionId: result.sessionId })
      .catch(() => undefined);
    const output = result.finalOutput as Learned | undefined;
    const known = new Set(memories.map((m) => m.text.trim().toLowerCase()));
    let kept = 0;
    for (const fact of output?.memories ?? []) {
      const text = fact.trim();
      if (!text || secretLike.test(text) || known.has(text.toLowerCase())) {
        continue;
      }
      known.add(text.toLowerCase());
      await this.remember(bot.id, text);
      kept++;
    }
    let suggested = 0;
    for (const idea of output?.suggestions ?? []) {
      if (pending + suggested >= maxPendingSuggestions) break;
      const body =
        idea.kind === 'instructions' ? idea.instructions : idea.skill;
      if (!body || secretLike.test(JSON.stringify(idea))) continue;
      await db.botSuggestion.create({
        data: {
          id: randomUUID(),
          botId: bot.id,
          userId: chat.userId,
          kind: idea.kind,
          title: idea.title,
          reason: idea.reason,
          instructions:
            idea.kind === 'instructions' ? (idea.instructions ?? null) : null,
          skill: idea.kind === 'skill' ? (idea.skill as never) : undefined,
        },
      });
      suggested++;
    }
    await db.chatSession.update({
      where: { id: sessionId },
      data: { learnedAt: messages[messages.length - 1].createdAt },
    });
    if (kept + suggested > 0) {
      this.activity.log({
        userId: chat.userId,
        actor: `agent:${bot.name}`,
        action: 'bot.learned',
        target: bot.id,
        detail: `${kept} new facts, ${suggested} suggestions.`,
      });
    }
  }

  async suggestions(botId: string, auth: Owner): Promise<BotSuggestionDto[]> {
    await this.own(botId, auth.user.id);
    const rows = await this.prisma.db.botSuggestion.findMany({
      where: { botId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return rows.map(toSuggestionDto);
  }

  // The user accepts: the change is made exactly as suggested (the skill
  // gets the usual safety scan).
  async acceptSuggestion(
    botId: string,
    suggestionId: string,
    auth: Owner,
  ): Promise<BotSuggestionDto> {
    const suggestion = await this.pendingSuggestion(botId, suggestionId, auth);
    const userId = auth.user.id;
    let changedBot:
      | {
          id: string;
          name: string;
          instructions: string;
          cencoriAgentId: string | null;
        }
      | undefined;
    let accepted: BotSuggestion;

    try {
      accepted = await this.prisma.db.$transaction(
        async (tx) => {
          const claimed = await tx.botSuggestion.updateMany({
            where: { id: suggestionId, botId, userId, status: 'pending' },
            data: { status: 'applying' },
          });
          if (claimed.count !== 1) {
            throw new ConflictException('This suggestion was already decided.');
          }

          if (suggestion.kind === 'instructions' && suggestion.instructions) {
            changedBot = await tx.bot.update({
              where: { id: botId },
              data: { instructions: suggestion.instructions },
              select: {
                id: true,
                name: true,
                instructions: true,
                cencoriAgentId: true,
              },
            });
          } else if (suggestion.kind === 'skill' && suggestion.skill) {
            const skill = suggestion.skill as {
              name?: unknown;
              description?: unknown;
              instructions?: unknown;
            };
            if (
              typeof skill.name !== 'string' ||
              !/^[a-z0-9-]{1,60}$/.test(skill.name) ||
              typeof skill.description !== 'string' ||
              skill.description.length < 1 ||
              skill.description.length > 300 ||
              typeof skill.instructions !== 'string' ||
              skill.instructions.length < 1 ||
              skill.instructions.length > 20_000
            ) {
              throw new BadRequestException(
                'This suggestion has invalid skill data.',
              );
            }
            if (
              (await tx.botSkill.count({ where: { botId } })) >= maxSkillsPerBot
            ) {
              throw new BadRequestException(
                `A bot can have up to ${maxSkillsPerBot} skills.`,
              );
            }
            if (
              await tx.botSkill.findFirst({
                where: { botId, name: skill.name },
              })
            ) {
              throw new ConflictException(
                'This bot already has a skill with this name.',
              );
            }
            const cencoriSkillId = await this.scanSkill(undefined, 1, {
              name: skill.name,
              description: skill.description,
              instructions: skill.instructions,
            });
            await tx.botSkill.create({
              data: {
                id: randomUUID(),
                botId,
                name: skill.name,
                description: skill.description,
                instructions: skill.instructions,
                cencoriSkillId,
              },
            });
          } else {
            throw new BadRequestException(
              'This suggestion has nothing to apply.',
            );
          }

          return tx.botSuggestion.update({
            where: { id: suggestionId },
            data: { status: 'accepted' },
          });
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          'This bot already has a skill with this name.',
        );
      }
      throw error;
    }

    if (changedBot?.cencoriAgentId) {
      await this.cencori
        .agentsUpdateConfig(changedBot.cencoriAgentId, {
          name: changedBot.name,
          config: { system_prompt: changedBot.instructions },
        })
        .catch(() =>
          this.logger.warn(`Bot ${botId} was not updated at Cencori.`),
        );
    }
    return toSuggestionDto(accepted);
  }

  async dismissSuggestion(
    botId: string,
    suggestionId: string,
    auth: Owner,
  ): Promise<BotSuggestionDto> {
    await this.pendingSuggestion(botId, suggestionId, auth);
    const where = {
      id: suggestionId,
      botId,
      userId: auth.user.id,
      status: 'pending',
    };
    const decided = await this.prisma.db.botSuggestion.updateMany({
      where,
      data: { status: 'dismissed' },
    });
    if (decided.count !== 1) {
      throw new ConflictException('This suggestion was already decided.');
    }
    return toSuggestionDto(
      await this.prisma.db.botSuggestion.findUniqueOrThrow({
        where: { id: suggestionId },
      }),
    );
  }

  private async pendingSuggestion(
    botId: string,
    suggestionId: string,
    auth: Owner,
  ): Promise<BotSuggestion> {
    await this.own(botId, auth.user.id);
    const suggestion = await this.prisma.db.botSuggestion.findFirst({
      where: { id: suggestionId, botId },
    });
    if (!suggestion) throw new NotFoundException('Suggestion not found.');
    if (suggestion.status !== 'pending') {
      throw new ConflictException(
        `This suggestion was already ${suggestion.status}.`,
      );
    }
    return suggestion;
  }

  // ── Skills: playbooks the bot can run ────────────────────────────────

  async skills(botId: string, auth: Owner): Promise<BotSkillDto[]> {
    await this.own(botId, auth.user.id);
    const skills = await this.prisma.db.botSkill.findMany({
      where: { botId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return skills.map(toSkillDto);
  }

  async addSkill(
    botId: string,
    auth: Owner,
    body: CreateBotSkillDto,
  ): Promise<BotSkillDto> {
    await this.own(botId, auth.user.id);
    const db = this.prisma.db;
    if ((await db.botSkill.count({ where: { botId } })) >= maxSkillsPerBot) {
      throw new BadRequestException(
        `A bot can have up to ${maxSkillsPerBot} skills.`,
      );
    }
    if (await db.botSkill.findFirst({ where: { botId, name: body.name } })) {
      throw new ConflictException(
        'This bot already has a skill with this name.',
      );
    }
    const cencoriSkillId = await this.scanSkill(undefined, 1, body);
    const skill = await db.botSkill.create({
      data: { id: randomUUID(), botId, ...body, cencoriSkillId },
    });
    return toSkillDto(skill);
  }

  // Brings a skill in from outside (a link or SKILL.md text) to look at
  // before installing: Cencori scans it, and the user sees its steps. The
  // token lets them install exactly this one, on this bot, for an hour.
  async previewSkill(
    botId: string,
    auth: Owner,
    body: PreviewSkillImportDto,
  ): Promise<SkillImportPreviewDto> {
    await this.own(botId, auth.user.id);
    if (!body.url === !body.text) {
      throw new BadRequestException('Send a url or the text, not both.');
    }
    if (!this.cencori.isConfigured) {
      throw new ServiceUnavailableException(
        'Skills from outside need the Cencori safety scan: set CENCORI_API_KEY.',
      );
    }
    const source = body.url ? skillFileUrl(body.url) : 'pasted text';
    const text = body.url ? await this.downloadSkill(source) : body.text!;
    const staged = (await this.cencori.sdk.skillImports.stage({ text })) as {
      id: string;
      normalized_manifest?: {
        files?: { content?: string }[];
        blocked?: boolean;
      };
      scan_findings?: unknown[];
    };
    const findings = (staged.scan_findings ?? []).map((finding) =>
      typeof finding === 'string' ? finding : JSON.stringify(finding),
    );
    if (staged.normalized_manifest?.blocked) {
      throw new BadRequestException(
        `This skill was blocked by the safety scan.${findings.length ? ` ${findings.join(' ')}` : ''}`,
      );
    }
    const skill = parseSkillFile(
      staged.normalized_manifest?.files?.[0]?.content ?? '',
    );
    if (!skill) {
      throw new BadRequestException(
        'That is not a skill: a SKILL.md needs a name and steps.',
      );
    }
    const token = signRunState(
      {
        importId: staged.id,
        userId: auth.user.id,
        botId,
        until: Date.now() + 60 * 60_000,
      },
      this.secret(),
    );
    return { token, ...skill, source, findings };
  }

  // Installs a previewed skill on the bot (limits and the scan apply again).
  async installSkill(
    botId: string,
    auth: Owner,
    body: InstallSkillDto,
  ): Promise<BotSkillDto> {
    await this.own(botId, auth.user.id);
    const ticket = readRunState(body.token, this.secret()) as {
      importId?: string;
      userId?: string;
      botId?: string;
      until?: number;
    } | null;
    if (
      !ticket?.importId ||
      ticket.userId !== auth.user.id ||
      ticket.botId !== botId ||
      !ticket.until ||
      ticket.until < Date.now()
    ) {
      throw new BadRequestException(
        'Preview the skill again, then install it.',
      );
    }
    const staged = (await this.cencori.sdk.skillImports.get(
      ticket.importId,
    )) as {
      normalized_manifest?: {
        files?: { content?: string }[];
        blocked?: boolean;
      };
    };
    const skill = staged.normalized_manifest?.blocked
      ? null
      : parseSkillFile(staged.normalized_manifest?.files?.[0]?.content ?? '');
    if (!skill)
      throw new BadRequestException('This skill cannot be installed.');
    const created = await this.addSkill(botId, auth, {
      ...skill,
      name: body.name ?? skill.name,
    });
    this.activity.log({
      userId: auth.user.id,
      actor: 'user',
      action: 'skills.installed',
      target: created.name,
    });
    return created;
  }

  // Downloads a SKILL.md from the public internet (never our own network),
  // up to 256 KB.
  private async downloadSkill(address: string): Promise<string> {
    const url = await assertPublicUrl(address).catch((error: Error) => {
      throw new BadRequestException(error.message);
    });
    const fetcher = safeFetch();
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(10_000),
        redirect: 'follow',
      });
      if (!response.ok) {
        throw new BadRequestException(
          `Could not read the skill there (${response.status}).`,
        );
      }
      const text = await response.text();
      if (text.length > 256 * 1024) {
        throw new BadRequestException('That skill file is too big.');
      }
      return text;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Could not read the skill at that link.');
    } finally {
      await fetcher.close();
    }
  }

  private secret(): string {
    const secret = this.config?.get<string>('BETTER_AUTH_SECRET');
    if (!secret) throw new ServiceUnavailableException('Not set up.');
    return secret;
  }

  async updateSkill(
    botId: string,
    skillId: string,
    auth: Owner,
    body: UpdateBotSkillDto,
  ): Promise<BotSkillDto> {
    await this.own(botId, auth.user.id);
    const db = this.prisma.db;
    const current = await db.botSkill.findFirst({
      where: { id: skillId, botId },
    });
    if (!current) throw new NotFoundException('Skill not found.');
    const next = { ...current, ...body };
    const version = current.version + 1;
    const cencoriSkillId = await this.scanSkill(
      current.cencoriSkillId ?? undefined,
      version,
      next,
    );
    try {
      const skill = await db.botSkill.update({
        where: { id: skillId },
        data: { ...body, version, cencoriSkillId },
      });
      return toSkillDto(skill);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          'This bot already has a skill with this name.',
        );
      }
      throw error;
    }
  }

  async removeSkill(
    botId: string,
    skillId: string,
    auth: Owner,
  ): Promise<void> {
    await this.own(botId, auth.user.id);
    const db = this.prisma.db;
    const skill = await db.botSkill.findFirst({
      where: { id: skillId, botId },
    });
    if (!skill) throw new NotFoundException('Skill not found.');
    await db.botSkill.delete({ where: { id: skillId } });
    if (skill.cencoriSkillId) {
      await this.cencori
        .skillsRemove(skill.cencoriSkillId, { force: true })
        .catch(() => undefined);
    }
  }

  // Sends the skill to Cencori as a new version: Cencori scans it for
  // unsafe content and keeps the version history. We keep our own copy, so
  // the skill is ours whatever happens. A skill the scan blocks is refused.
  // If Cencori is off or away, the skill is saved without a scan.
  private async scanSkill(
    cencoriSkillId: string | undefined,
    version: number,
    skill: { name: string; description: string; instructions: string },
  ): Promise<string | null> {
    if (!this.cencori.isConfigured) return cencoriSkillId ?? null;
    let id = cencoriSkillId;
    let blocked = false;
    try {
      id ??= (
        (await this.cencori.skillsCreate({
          name: skill.name,
          description: skill.description,
        })) as { id: string }
      ).id;
      const semver = `1.0.${version}`;
      const created = (await this.cencori.skillsCreateVersion(id, {
        version: semver,
        content: skill.instructions,
      })) as { blocked?: boolean };
      blocked = created.blocked === true;
      if (!blocked) await this.cencori.skillsPublishVersion(id, semver);
    } catch {
      this.logger.warn('A skill was saved without the Cencori safety scan.');
    }
    if (blocked) {
      throw new BadRequestException(
        'This skill was blocked by the safety scan. Remove anything unsafe and try again.',
      );
    }
    return id ?? null;
  }

  // ── For the chat ─────────────────────────────────────────────────────

  // What the chat needs to run this bot, for its owner only.
  private async runtime(userId: string, botId: string): Promise<BotRuntime> {
    const bot = await this.own(botId, userId);
    if (!bot.enabled) throw new NotFoundException('Bot not found.');
    if (bot.hiredUntil && bot.hiredUntil.getTime() < Date.now()) {
      throw new HttpException(
        'Your monthly hire of this bot has ended. Renew it on the marketplace to use it again.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return this.toRuntime(bot, true);
  }

  // The user's bots the default assistant may hand a chat to: the ones that
  // are on and say what they are for.
  private async forAssistant(userId: string): Promise<BotRuntime[]> {
    const bots = await this.prisma.db.bot.findMany({
      where: {
        userId,
        enabled: true,
        description: { not: null },
        // Not a hired bot whose month ran out.
        OR: [{ hiredUntil: null }, { hiredUntil: { gt: new Date() } }],
      },
      include: withIntegrations,
      orderBy: { updatedAt: 'desc' },
      take: maxBotsForAssistant,
    });
    // App connections need a chat started with the bot itself, so a handoff
    // gets the bot's memories, skills and own MCP servers.
    return Promise.all(bots.map((bot) => this.toRuntime(bot, false)));
  }

  // The user's bots among these that are on, ready to work in a group.
  async forGroup(userId: string, botIds: string[]): Promise<BotRuntime[]> {
    const bots = await this.prisma.db.bot.findMany({
      where: { userId, enabled: true, id: { in: botIds } },
      include: withIntegrations,
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(bots.map((bot) => this.toRuntime(bot, false)));
  }

  private async toRuntime(
    bot: BotWithIntegrations,
    linkApps: boolean,
  ): Promise<BotRuntime> {
    const db = this.prisma.db;
    const integrations = bot.integrations.map((link) => link.integration);
    const documentIds = bot.documents.map((link) => link.document.id);
    const [memories, skills, mcpServers, cencori] = await Promise.all([
      db.botMemory.findMany({
        where: { botId: bot.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: memoriesInPrompt,
        select: { text: true },
      }),
      db.botSkill.findMany({
        where: { botId: bot.id },
        orderBy: { createdAt: 'asc' },
        select: { name: true, description: true, instructions: true },
      }),
      this.integrations.mcpServers(integrations),
      linkApps ? this.link(bot, integrations) : undefined,
    ]);
    return {
      id: bot.id,
      name: bot.name,
      description: bot.description,
      instructions: bot.instructions,
      memories: memories.map((memory) => memory.text).reverse(),
      skills,
      mcpServers,
      cencori,
      documents: bot.documents.map((link) => link.document.name),
      searchDocuments: (query) =>
        this.documents.searchText(bot.userId, query, documentIds),
      saveMemory: async (text) => {
        await this.remember(bot.id, text);
      },
      updateInstructions: async (instructions) => {
        await this.update(
          bot.id,
          { user: { id: bot.userId } },
          { instructions },
        );
      },
      // A taught task: a new skill, or a new version of one with its name.
      // Limits and the safety scan apply as when the user adds one.
      saveSkill: async (skill) => {
        const owner = { user: { id: bot.userId } };
        const current = await this.prisma.db.botSkill.findFirst({
          where: { botId: bot.id, name: skill.name },
          select: { id: true },
        });
        try {
          if (current) {
            await this.updateSkill(bot.id, current.id, owner, skill);
            return `Skill "${skill.name}" updated. I will follow the new steps from now on.`;
          }
          await this.addSkill(bot.id, owner, skill);
          return `Skill "${skill.name}" saved. I will follow these steps whenever this task comes up.`;
        } catch (error) {
          return `Not saved: ${error instanceof Error ? error.message : 'something went wrong.'}`;
        }
      },
    };
  }

  // App connections (Gmail, Slack...) reach a bot through a Cencori
  // "installation": the bot's copy at Cencori plus the connections it may
  // use. Made when the bot first has a signed-in connection, re-made when the
  // set changes, removed when none are left. If Cencori is away the bot
  // still chats, just without those tools.
  private async link(
    bot: Bot,
    integrations: Integration[],
  ): Promise<BotRuntime['cencori']> {
    try {
      const active = await this.integrations.activeConnections(
        bot.userId,
        integrations,
      );
      const wanted = active ? [...active.connectionIds].sort().join(',') : null;
      const upToDate =
        wanted === bot.linkedConnections &&
        (!wanted || (bot.cencoriAgentId && bot.installationId));
      if (upToDate) {
        return active && bot.cencoriAgentId && bot.installationId
          ? {
              agentId: bot.cencoriAgentId,
              tenantId: active.tenantId,
              installationId: bot.installationId,
            }
          : undefined;
      }

      // Cencori cannot change an installation in place, so replace it.
      if (bot.installationId) {
        await this.cencori.installationsRemove(bot.installationId);
      }
      if (!active) {
        await this.saveLink(bot.id, null, null);
        return undefined;
      }
      const agentId =
        bot.cencoriAgentId ??
        (
          await this.cencori.agentsCreate({
            name: bot.name,
            config: { system_prompt: bot.instructions },
          })
        ).id;
      const installation = (await this.cencori.installationsCreate({
        tenant_id: active.tenantId,
        agent_id: agentId,
        connection_ids: active.connectionIds,
      })) as { id: string };
      await this.saveLink(bot.id, installation.id, wanted, agentId);
      return {
        agentId,
        tenantId: active.tenantId,
        installationId: installation.id,
      };
    } catch {
      this.logger.warn(`Bot ${bot.id} could not link its app connections.`);
      return undefined;
    }
  }

  private async saveLink(
    botId: string,
    installationId: string | null,
    linkedConnections: string | null,
    cencoriAgentId?: string,
  ): Promise<void> {
    await this.prisma.db.bot.update({
      where: { id: botId },
      // updatedAt stays: this is bookkeeping, not a change by the user.
      data: {
        installationId,
        linkedConnections,
        ...(cencoriAgentId && { cencoriAgentId }),
      },
    });
  }

  // Every id must be one of the user's own documents.
  private async checkDocuments(
    userId: string,
    ids: string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const owned = await this.documents.owned(userId, ids);
    if (owned.length !== ids.length) {
      throw new BadRequestException('Unknown document.');
    }
    return ids;
  }

  // Every id must be one of the user's own integrations.
  private async checkIntegrations(
    userId: string,
    ids: string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const owned = await this.integrations.owned(userId, ids);
    if (owned.length !== ids.length) {
      throw new BadRequestException('Unknown integration.');
    }
    return ids;
  }

  private async own(id: string, userId: string): Promise<BotWithIntegrations> {
    const bot = await this.prisma.db.bot.findUnique({
      where: { id },
      include: withIntegrations,
    });
    if (!bot || bot.userId !== userId) {
      throw new NotFoundException('Bot not found.');
    }
    return bot;
  }
}

function toDto(bot: BotWithIntegrations): BotDto {
  return {
    id: bot.id,
    name: bot.name,
    description: bot.description,
    instructions: bot.instructions,
    enabled: bot.enabled,
    integrations: bot.integrations.map(({ integration }) => ({
      id: integration.id,
      name: integration.name,
      app: integration.app,
    })),
    documents: bot.documents.map(({ document }) => ({
      id: document.id,
      name: document.name,
    })),
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
  };
}

function toSkillDto(skill: BotSkill): BotSkillDto {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    version: skill.version,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

function toSuggestionDto(row: BotSuggestion): BotSuggestionDto {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    reason: row.reason,
    instructions: row.instructions,
    skill: (row.skill as BotSuggestionDto['skill']) ?? null,
    status: row.status,
    createdAt: row.createdAt,
  };
}
