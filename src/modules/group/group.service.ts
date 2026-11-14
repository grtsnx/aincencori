import {
  BadRequestException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { maxGroupsPerUser } from '@/config/agents/limits.js';
import type {
  CreateGroupDto,
  GroupDto,
  ListGroupsQueryDto,
  UpdateGroupDto,
} from '@/dto';
import type { Bot, BotGroup } from '@/generated/prisma/client.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { serializableTransaction } from '@/middleware';
import { BotService } from '../bot/bot.service.js';
import { ChatService, type GroupRuntime } from '../chat/chat.service.js';

interface Owner {
  user: { id: string };
}

type GroupWithBots = BotGroup & { members: { bot: Bot }[] };

const withBots = { members: { include: { bot: true } } } as const;

// Groups: a team of a user's bots on one chat (POST /v1/chat with groupId).
// A built-in lead reads each message and asks the bots that fit; the bots
// can ask each other too. Each bot keeps its own memories, skills and
// integrations.
@Injectable()
export class GroupService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bots: BotService,
    private readonly chat: ChatService,
  ) {}

  onModuleInit(): void {
    this.chat.useGroups((userId, groupId) => this.runtime(userId, groupId));
  }

  async list(auth: Owner, query: ListGroupsQueryDto): Promise<GroupDto[]> {
    const groups = await this.prisma.db.botGroup.findMany({
      where: { userId: auth.user.id },
      include: withBots,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
    return groups.map(toDto);
  }

  async get(id: string, auth: Owner): Promise<GroupDto> {
    return toDto(await this.own(id, auth.user.id));
  }

  async create(auth: Owner, body: CreateGroupDto): Promise<GroupDto> {
    const userId = auth.user.id;
    await this.checkBots(userId, body.botIds);
    const { botIds, ...rest } = body;
    const group = await serializableTransaction(this.prisma.db, async (tx) => {
      const count = await tx.botGroup.count({ where: { userId } });
      if (count >= maxGroupsPerUser) {
        throw new BadRequestException(
          `You can have up to ${maxGroupsPerUser} groups.`,
        );
      }
      return tx.botGroup.create({
        data: {
          id: randomUUID(),
          userId,
          ...rest,
          members: { create: botIds.map((botId) => ({ botId })) },
        },
        include: withBots,
      });
    });
    return toDto(group);
  }

  async update(
    id: string,
    auth: Owner,
    body: UpdateGroupDto,
  ): Promise<GroupDto> {
    await this.own(id, auth.user.id);
    const { botIds, ...rest } = body;
    if (botIds) await this.checkBots(auth.user.id, botIds);
    const group = await this.prisma.db.botGroup.update({
      where: { id },
      data: {
        ...rest,
        ...(botIds && {
          members: {
            deleteMany: {},
            create: botIds.map((botId) => ({ botId })),
          },
        }),
      },
      include: withBots,
    });
    return toDto(group);
  }

  // The bots stay; only the group goes.
  async remove(id: string, auth: Owner): Promise<void> {
    await this.own(id, auth.user.id);
    await this.prisma.db.botGroup.delete({ where: { id } });
  }

  // What the chat needs to run this group, for its owner only. Bots that
  // were switched off sit out.
  private async runtime(
    userId: string,
    groupId: string,
  ): Promise<GroupRuntime> {
    const group = await this.own(groupId, userId);
    const members = await this.bots.forGroup(
      userId,
      group.members.map((member) => member.bot.id),
    );
    if (members.length === 0) {
      throw new BadRequestException('This group has no bots that are on.');
    }
    return {
      id: group.id,
      name: group.name,
      instructions: group.instructions,
      members,
    };
  }

  // Every bot must be the user's own, and names must differ: the bots are
  // asked by name.
  private async checkBots(userId: string, botIds: string[]): Promise<void> {
    const bots = await this.prisma.db.bot.findMany({
      where: { userId, id: { in: botIds } },
      select: { name: true },
    });
    if (bots.length !== botIds.length) {
      throw new BadRequestException('Unknown bot.');
    }
    if (new Set(bots.map((bot) => bot.name)).size !== bots.length) {
      throw new BadRequestException('Bots in a group need different names.');
    }
  }

  private async own(id: string, userId: string): Promise<GroupWithBots> {
    const group = await this.prisma.db.botGroup.findUnique({
      where: { id },
      include: withBots,
    });
    if (!group || group.userId !== userId) {
      throw new NotFoundException('Group not found.');
    }
    return group;
  }
}

function toDto(group: GroupWithBots): GroupDto {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    instructions: group.instructions,
    bots: group.members.map(({ bot }) => ({
      id: bot.id,
      name: bot.name,
      description: bot.description,
    })),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}
