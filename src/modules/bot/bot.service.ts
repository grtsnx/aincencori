import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { deleteBotAgentJob } from '@/config/agents/jobs.js';
import {
  maxBotsForAssistant,
  maxBotsPerUser,
  maxMemoriesPerBot,
  maxSkillsPerBot,
  memoriesInPrompt,
} from '@/config/agents/limits.js';
import type {
  BotDto,
  BotMemoryDto,
  BotSkillDto,
  CreateBotDto,
  CreateBotMemoryDto,
  CreateBotSkillDto,
  ListBotsQueryDto,
  UpdateBotDto,
  UpdateBotSkillDto,
} from '@/dto';
import type { Bot, BotSkill, Integration } from '@/generated/prisma/client.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { CencoriService } from '@/lib/cencori/cencori.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { type BotRuntime, ChatService } from '../chat/chat.service.js';
import { DocumentService } from '../document/document.service.js';
import { IntegrationService } from '../integration/integration.service.js';

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
  ) {}

  onModuleInit(): void {
    // The chat loads a user's bot through us.
    this.chat.useBots({
      one: (userId, botId) => this.runtime(userId, botId),
      forAssistant: (userId) => this.forAssistant(userId),
    });
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

  // Saves a fact. When the bot is full, the oldest fact makes room.
  private async remember(botId: string, text: string): Promise<BotMemoryDto> {
    const db = this.prisma.db;
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
    return this.toRuntime(bot, true);
  }

  // The user's bots the default assistant may hand a chat to: the ones that
  // are on and say what they are for.
  private async forAssistant(userId: string): Promise<BotRuntime[]> {
    const bots = await this.prisma.db.bot.findMany({
      where: { userId, enabled: true, description: { not: null } },
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
