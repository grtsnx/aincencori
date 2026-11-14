import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseWebhook } from 'cencori';
import { randomUUID } from 'node:crypto';
import { approvalCard } from '@/config/agents/cards.js';
import { pendingApprovalDays } from '@/config/agents/limits.js';
import {
  answerByRules,
  chatRuleDays,
  decideTool,
  deniedToolMessage,
  riskyTools,
  type ToolDecision,
  type ToolRuleView,
} from '@/config/agents/policy.js';
import type {
  AnswerApprovalDto,
  PendingApprovalDto,
  PendingApprovalItemDto,
  SetToolRuleDto,
  ToolInfoDto,
  ToolRuleDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CencoriService } from '@/lib/cencori/cencori.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { NotificationService } from '../notification/notification.service.js';

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
  save_skill: 'Let a bot save a task you taught it as a skill.',
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

// Cencori's webhooks send ids without their prefix ("ten_", "act_"), while
// its API returns them with it. Both forms, to match either.
function withAndWithout(prefix: string, id: string): string[] {
  return id.startsWith(prefix)
    ? [id, id.slice(prefix.length)]
    : [id, prefix + id];
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

  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly cencori: CencoriService,
    private readonly config: ConfigService,
    private readonly notifications?: NotificationService,
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

  // A run stopped at risky steps: put it in the inbox.
  async recordPending(input: {
    userId: string;
    chatId: string;
    botId?: string | null;
    source: 'chat' | 'routine' | 'plan' | 'app';
    items: Omit<PendingApprovalItemDto, 'card'>[];
    state: string;
  }): Promise<void> {
    const db = this.prisma.db;
    await db.$transaction([
      // A chat has at most one paused run, so a newer one replaces the
      // older. App steps wait on their own, each with its own state.
      db.pendingApproval.deleteMany({
        where:
          input.source === 'app'
            ? { userId: input.userId, state: input.state }
            : {
                userId: input.userId,
                chatId: input.chatId,
                source: { not: 'app' },
              },
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
    // In a chat the user sees the card; elsewhere they are told.
    if (input.source !== 'chat') {
      const first = withCards(input.items)[0]?.card;
      const from = {
        routine: 'A routine',
        plan: 'A plan',
        app: 'A connected app',
      }[input.source];
      this.notifications?.notify(input.userId, 'approval', {
        title: 'A step is waiting for your approval',
        body: `${from} wants to: ${first?.title ?? 'do something'}${
          input.items.length > 1 ? ` (and ${input.items.length - 1} more)` : ''
        }.`,
        link: '/approvals',
      });
    }
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
  // answer when asked to, and take it out of the inbox. Returns the steps
  // that were waiting, or null when there is no such entry.
  async resolve(
    userId: string,
    state: string,
    decisions: Record<string, ApprovalDecision>,
  ): Promise<PendingApprovalItemDto[] | null> {
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
    if (!row) return null;
    const { count } = await db.pendingApproval.deleteMany({
      where: { id: row.id, userId, state },
    });
    if (count !== 1) return null;
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
    return items;
  }

  // Cencori runs connected-app tools (Gmail...) itself, and stops at risky
  // ones (sending email, deleting, paying) until someone answers. It tells
  // us through a signed webhook; the user's rules answer when they can,
  // otherwise the step waits in the inbox. The step's details are read from
  // Cencori, never taken from the webhook body.
  async cencoriWebhook(
    rawBody: unknown,
    signature: string | undefined,
  ): Promise<void> {
    const secret = this.config.get<string>('CENCORI_WEBHOOK_SECRET');
    if (!secret || !this.cencori.isConfigured) {
      throw new ServiceUnavailableException('Cencori webhooks are not set up.');
    }
    const payload =
      typeof rawBody === 'string'
        ? await parseWebhook(rawBody, signature, secret)
        : null;
    if (!payload) {
      this.logger.warn(
        `A Cencori webhook was refused (${typeof rawBody === 'string' ? 'bad signature or too old' : 'body not read as text'}).`,
      );
      throw new UnauthorizedException('Bad signature.');
    }
    if (payload.event !== 'action.required') return;
    // The body is signed by Cencori, so its ids can be trusted. It names the
    // step and the user's tenant (their space at Cencori); a chat id too,
    // when Cencori sends one.
    const data = payload.data as Record<string, unknown>;
    const text = (value: unknown) =>
      typeof value === 'string' && value !== '' ? value : undefined;
    const actionId = text(data.action_id) ?? text(data.id);
    const tenantId = text(data.tenant_id);
    const sessionId = text(data.session_id);
    if (!actionId || (!tenantId && !sessionId)) {
      this.logger.warn(
        `A Cencori step could not be matched (fields: ${Object.keys(data).join(', ')}).`,
      );
      return;
    }

    // Whose step it is: the chat it ran in, else the tenant's owner.
    const chat = sessionId
      ? await this.prisma.db.chatSession.findFirst({
          where: { id: { in: withAndWithout('ses_', sessionId) } },
          select: { id: true, userId: true, botId: true },
        })
      : null;
    const userId =
      chat?.userId ??
      (tenantId
        ? (
            await this.prisma.db.agentWorkspace.findFirst({
              where: { tenantId: { in: withAndWithout('ten_', tenantId) } },
              select: { userId: true },
            })
          )?.userId
        : undefined);
    // Not one of our users: Cencori's own default applies.
    if (!userId) return;

    // What the step does, read from Cencori (the same values the card shows).
    let action: {
      id: string;
      tool: string;
      arguments?: unknown;
      status: string;
    };
    try {
      action = (await this.cencori.sdk.actions.get(actionId)) as typeof action;
    } catch {
      this.logger.warn(`Cencori step ${actionId} could not be read.`);
      return;
    }
    if (action.status !== 'pending') return;

    const item = {
      callId: action.id,
      toolName: action.tool,
      arguments: JSON.stringify(action.arguments ?? {}),
    };
    const rules = await this.rulesFor(userId);
    const { answered } = answerByRules([item], rules, {
      botId: chat?.botId,
      chatId: chat?.id,
    });
    const answer = answered[action.id];
    if (answer) {
      await this.decideAction(action.id, answer.approved, 'rule');
      this.logRuleAnswers(userId, [item], answered);
      return;
    }
    await this.recordPending({
      userId,
      // Without a chat, the step's own id keeps the entry apart.
      chatId: chat?.id ?? action.id,
      botId: chat?.botId ?? null,
      source: 'app',
      items: [item],
      state: `action:${action.id}`,
    });
  }

  // The user answers a waiting app step from the inbox. (Steps from chats,
  // routines and plans are answered in their chat, which then continues.)
  async answer(
    auth: AuthSession,
    id: string,
    body: AnswerApprovalDto,
  ): Promise<void> {
    const userId = auth.user.id;
    const row = await this.prisma.db.pendingApproval.findFirst({
      where: { id, userId },
    });
    if (!row) throw new NotFoundException('Approval not found.');
    if (row.source !== 'app') {
      throw new BadRequestException(
        'Answer this in its chat, so the chat can continue.',
      );
    }
    const [item] = row.items as unknown as PendingApprovalItemDto[];
    const resolved = await this.resolve(userId, row.state, {
      [item.callId]: { approved: body.approved, remember: body.remember },
    });
    if (!resolved) throw new NotFoundException('Approval not found.');
    await this.decideAction(item.callId, body.approved, `user:${userId}`);
  }

  // Tells Cencori the answer. It runs an approved step once.
  private async decideAction(
    actionId: string,
    approved: boolean,
    by: string,
  ): Promise<void> {
    try {
      if (approved) {
        await this.cencori.sdk.actions.approve(actionId, { approved_by: by });
      } else {
        await this.cencori.sdk.actions.reject(actionId, {
          rejected_by: by,
          reason: deniedToolMessage,
        });
      }
    } catch (error) {
      const failed = error as { status?: number; statusCode?: number };
      const status = failed.status ?? failed.statusCode;
      // Already answered elsewhere, or too late.
      if (status === 409 || status === 410) {
        throw new ConflictException(
          'This step was already answered or has expired.',
        );
      }
      this.logger.error(`Cencori did not take the answer for ${actionId}.`);
      throw new ServiceUnavailableException(
        'Cencori did not take the answer. Try again.',
      );
    }
  }

  // Steps the user's rules answered by themselves, for the activity log.
  logRuleAnswers(
    userId: string,
    items: { callId: string; toolName: string }[],
    answered: Record<string, { approved: boolean }>,
  ): void {
    for (const item of items) {
      const answer = answered[item.callId];
      if (!answer) continue;
      this.activity.log({
        userId,
        actor: 'rule',
        action: answer.approved ? 'approval.allowed' : 'approval.denied',
        target: item.toolName,
        detail: 'Answered by your tool rules.',
      });
    }
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
