import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { approvalCard } from '@/config/agents/cards.js';
import { pendingApprovalDays } from '@/config/agents/limits.js';
import {
  chatRuleDays,
  decideTool,
  riskyTools,
  type ToolDecision,
  type ToolRuleView,
} from '@/config/agents/policy.js';
import type {
  PendingApprovalDto,
  PendingApprovalItemDto,
  SetToolRuleDto,
  ToolInfoDto,
  ToolRuleDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';

// How long a user's rules are kept in memory between chat turns.
const cacheMs = 60_000;

// What the risky tools do, for settings screens.
const toolDescriptions: Record<(typeof riskyTools)[number], string> = {
  change_my_name: 'Change your display name.',
  create_routine: 'Create a scheduled task.',
  set_routine_enabled: 'Pause or resume a scheduled task.',
  delete_routine: 'Delete a scheduled task.',
  start_plan: 'Start a plan that runs in the background.',
  update_my_instructions: 'Let a bot rewrite its own instructions.',
  computer_run_command: 'Run a command on your cloud computer.',
  computer_write_file: 'Write a file on your cloud computer.',
};

// Each waiting step with the card our code writes for it (see cards.ts).
export function withCards(
  items: Omit<PendingApprovalItemDto, 'card'>[],
): PendingApprovalItemDto[] {
  return items.map((item) => ({
    ...item,
    card: approvalCard(item.toolName, item.arguments),
  }));
}

export interface ApprovalDecision {
  approved: boolean;
  // Remember the answer: for this chat (a week), or always.
  remember?: 'chat' | 'always';
}

// The permission gate between the AI and risky actions. The AI only
// proposes; the user's rules and approval cards decide. Also keeps the
// inbox of steps waiting for the user (from chats, routines and plans).
@Injectable()
export class ApprovalService {
  private readonly cache = new Map<
    string,
    { at: number; rules: ToolRuleView[] }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  // The user's current rules (read fresh, then kept briefly in memory).
  async rulesFor(userId: string): Promise<ToolRuleView[]> {
    const rules = await this.prisma.db.toolRule.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { tool: true, botId: true, chatId: true, decision: true },
      orderBy: { createdAt: 'desc' },
    });
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(userId, { at: Date.now(), rules });
    return rules;
  }

  // The decision for an app tool from the rules last read, without waiting
  // (MCP servers ask synchronously). Only rules for everywhere apply.
  cachedDecision(userId: string, tool: string): ToolDecision {
    const entry = this.cache.get(userId);
    if (!entry || entry.at < Date.now() - cacheMs) return 'ask';
    return decideTool(entry.rules, tool, {});
  }

  tools(): ToolInfoDto[] {
    return riskyTools.map((tool) => ({
      tool,
      description: toolDescriptions[tool],
    }));
  }

  listRules(auth: AuthSession): Promise<ToolRuleDto[]> {
    return this.prisma.db.toolRule.findMany({
      where: {
        userId: auth.user.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  // Sets the standing answer for a tool, here or everywhere.
  async setRule(auth: AuthSession, body: SetToolRuleDto): Promise<ToolRuleDto> {
    const userId = auth.user.id;
    if (body.botId) {
      const bot = await this.prisma.db.bot.findFirst({
        where: { id: body.botId, userId },
        select: { id: true },
      });
      if (!bot) throw new NotFoundException('Bot not found.');
    }
    const rule = await this.saveRule(userId, {
      tool: body.tool,
      decision: body.decision,
      botId: body.botId ?? null,
      chatId: null,
      expiresAt: null,
    });
    return rule;
  }

  async removeRule(auth: AuthSession, id: string): Promise<void> {
    const { count } = await this.prisma.db.toolRule.deleteMany({
      where: { id, userId: auth.user.id },
    });
    if (count === 0) throw new NotFoundException('Rule not found.');
    this.cache.delete(auth.user.id);
  }

  // Steps waiting for the user, newest first.
  async inbox(auth: { user: { id: string } }): Promise<PendingApprovalDto[]> {
    const rows = await this.prisma.db.pendingApproval.findMany({
      where: {
        userId: auth.user.id,
        createdAt: {
          gt: new Date(Date.now() - pendingApprovalDays * 24 * 60 * 60_000),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({
      ...row,
      items: withCards(row.items as unknown as PendingApprovalItemDto[]),
    }));
  }

  // The user says no to everything waiting in one inbox entry.
  async dismiss(auth: AuthSession, id: string): Promise<void> {
    const row = await this.prisma.db.pendingApproval.findFirst({
      where: { id, userId: auth.user.id },
    });
    if (!row) throw new NotFoundException('Approval not found.');
    await this.prisma.db.pendingApproval.delete({ where: { id } });
  }

  // A run stopped at risky steps: put it in the inbox. A chat has at most
  // one paused run, so a newer one replaces the older.
  async recordPending(input: {
    userId: string;
    chatId: string;
    botId?: string | null;
    source: 'chat' | 'routine' | 'plan';
    items: Omit<PendingApprovalItemDto, 'card'>[];
    state: string;
  }): Promise<void> {
    const db = this.prisma.db;
    await db.$transaction([
      db.pendingApproval.deleteMany({
        where: { userId: input.userId, chatId: input.chatId },
      }),
      db.pendingApproval.create({
        data: {
          id: randomUUID(),
          userId: input.userId,
          chatId: input.chatId,
          botId: input.botId ?? null,
          source: input.source,
          items: withCards(input.items) as never,
          state: input.state,
        },
      }),
    ]);
    for (const item of input.items) {
      this.activity.log({
        userId: input.userId,
        actor: item.agentName ? `agent:${item.agentName}` : 'agent',
        action: 'approval.requested',
        target: item.toolName,
        detail: `From a ${input.source}.`,
      });
    }
  }

  // The user decided (in a chat, or from the inbox): log it, remember the
  // answer when asked to, and take it out of the inbox.
  async resolve(
    userId: string,
    state: string,
    decisions: Record<string, ApprovalDecision>,
  ): Promise<boolean> {
    const db = this.prisma.db;
    const row = await db.pendingApproval.findFirst({
      where: {
        userId,
        state,
        createdAt: {
          gt: new Date(Date.now() - pendingApprovalDays * 24 * 60 * 60_000),
        },
      },
    });
    if (!row) return false;
    const { count } = await db.pendingApproval.deleteMany({
      where: { id: row.id, userId, state },
    });
    if (count !== 1) return false;
    const items = row.items as unknown as PendingApprovalItemDto[];
    for (const [callId, decision] of Object.entries(decisions)) {
      const item = items.find((candidate) => candidate.callId === callId);
      if (!item) continue;
      this.activity.log({
        userId,
        actor: 'user',
        action: decision.approved ? 'approval.allowed' : 'approval.denied',
        target: item.toolName,
        detail: decision.remember ? `Remembered (${decision.remember}).` : null,
      });
      if (!decision.remember) continue;
      // Our own tools can be remembered per bot; app tools everywhere.
      const ours = (riskyTools as readonly string[]).includes(item.toolName);
      await this.saveRule(userId, {
        tool: item.toolName,
        decision: decision.approved ? 'allow' : 'deny',
        botId: decision.remember === 'always' && ours ? row.botId : null,
        chatId: decision.remember === 'chat' ? row.chatId : null,
        expiresAt:
          decision.remember === 'chat'
            ? new Date(Date.now() + chatRuleDays * 24 * 60 * 60_000)
            : null,
      });
    }
    return true;
  }

  // One rule per tool and place: a new answer replaces the old one.
  private async saveRule(
    userId: string,
    rule: Omit<ToolRuleView, 'decision'> & {
      decision: string;
      expiresAt: Date | null;
    },
  ): Promise<ToolRuleDto> {
    const db = this.prisma.db;
    const [, created] = await db.$transaction([
      db.toolRule.deleteMany({
        where: {
          userId,
          tool: rule.tool,
          botId: rule.botId,
          chatId: rule.chatId,
        },
      }),
      db.toolRule.create({ data: { id: randomUUID(), userId, ...rule } }),
    ]);
    this.cache.delete(userId);
    return created;
  }
}
