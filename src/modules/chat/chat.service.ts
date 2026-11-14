import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request as ExpressRequest, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Agent } from 'cencori/agents';
import {
  type AskBot,
  type BotParts,
  type ChatContext,
  type ComputerActions,
  createBotAgent,
  createGroupAgent,
  createChatAgent,
  type RoutineActions,
  followUpsTool,
  replyToMessageTool,
} from '@/config/agents/agents.js';
import {
  deleteCencoriSessionJob as deleteAtCencori,
  deleteFilesJob,
  learnFromChatJob,
  userFilesPrefix,
} from '@/config/agents/jobs.js';
import {
  maxAgentTurns,
  maxGroupAsks,
  maxGroupBotTurns,
  learnDelayMs,
  learnEveryMs,
} from '@/config/agents/limits.js';
import type {
  ChatHistoryMessageDto,
  ChatHistoryQueryDto,
  ChatRequestDto,
  ChatSessionDto,
  ChatStatusDto,
  PendingApprovalItemDto,
} from '@/dto';
import {
  type AuthSession,
  BetterAuthService,
} from '@/lib/better-auth/better-auth.service.js';
import { CencoriService } from '@/lib/cencori/cencori.service.js';
import { Prisma } from '@/generated/prisma/client.js';
import { ActivityService } from '../activity/activity.service.js';
import { ApprovalService, withCards } from '../approval/approval.service.js';
import { UsageService } from '../usage/usage.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { assertStaff, readableImage, signRunState } from '@/middleware';
import { decideTool, type ToolRuleView } from '@/config/agents/policy.js';
import { R2Service } from '@/lib/r2/r2.service.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';

interface ChatUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

// A file a user attached, as kept on a message. No key: stored by name only.
interface StoredFile {
  name: string;
  kind: 'image' | 'file';
  contentType: string;
  key?: string;
  size?: number;
}

// The same limit Cencori puts on one attachment.
const maxFileBytes = 10 * 1_048_576;

// Reads a message's files. Older messages kept only the file names.
function storedFiles(value: unknown): StoredFile[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: unknown) =>
    typeof item === 'string'
      ? { name: item, kind: 'file', contentType: 'application/octet-stream' }
      : (item as StoredFile),
  );
}

// One message to answer without a browser watching (see ChatService.ask).
export interface AskInput {
  message: string;
  chatId?: string;
  botId?: string;
  groupId?: string;
  title?: string;
  routineId?: string;
  // What started it, for the approvals inbox. Default: routine when
  // routineId is set, else chat.
  source?: 'chat' | 'routine' | 'plan';
  stopNote?: string;
  // The answer will be read aloud (a voice call): short, no formatting.
  spoken?: boolean;
}

export interface AskResult {
  // Next steps the agent offered (often none).
  followUps?: string[];
  chatId: string;
  answeredBy: string;
  answer: string;
  needsApproval: boolean;
}

// What the chat needs to run one of a user's bots.
export interface BotRuntime extends BotParts {
  id: string;
  // Set when the bot has signed-in app connections (Gmail, Slack...).
  cencori?: { agentId: string; tenantId: string; installationId: string };
}

// A group of a user's bots, ready for a chat.
export interface GroupRuntime {
  id: string;
  name: string;
  instructions?: string | null;
  members: BotRuntime[];
}

// What one bot said inside a group while a message was being answered.
interface GroupSaid {
  bot: string;
  text: string;
  at: Date;
}

// How the chat gets bots from the bot module.
export interface BotLoader {
  // One of the user's bots, for a chat with it.
  one: (userId: string, botId: string) => Promise<BotRuntime>;
  // The user's bots the default assistant may hand a chat to.
  forAssistant: (userId: string) => Promise<BotRuntime[]>;
}

// A routine run's answer: done, or stopped at a step the user must approve.
export type RoutineRunStatus = 'ok' | 'needs-approval';

// Secrets the agent must never repeat (checked by its answer guardrail).
const secretSettings = [
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_API_KEY',
  'CENCORI_API_KEY',
  'SENDBYTE_API_KEY',
  'SMTP_PASSWORD',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_SECRET',
  'DISCORD_CLIENT_SECRET',
  'RECAPTCHA_SECRET_KEY',
  'DATABASE_URL',
  'LIVEKIT_API_SECRET',
  'INSTABOX_API_KEY',
];

// Chat with the agents (see config/agents/agents.ts). The chat streams
// events: text, widgets, tool calls, handoffs, approvals. Each chat belongs
// to the user who started it; staff answer chats the agent handed to a person.
@Injectable()
export class ChatService implements OnModuleInit {
  private readonly logger = new Logger(ChatService.name);
  private readonly agent: Agent<ChatContext>;
  // Set by the routine module when the app starts.
  private routineActions?: RoutineActions;
  // Set by the bot module: loads one of the user's bots for a chat.
  private bots?: BotLoader;
  // Set by the group module: loads one of the user's groups for a chat.
  private groups?: (userId: string, groupId: string) => Promise<GroupRuntime>;
  // Set by the document module: searches a user's documents, as text.
  private documentSearch?: (userId: string, query: string) => Promise<string>;
  // Set by the plan module: starts a plan for a user.
  private planStarter?: (
    userId: string,
    goal: string,
  ) => Promise<{ id: string }>;
  private readonly secrets: string[];
  // True when agents have their own computer (INSTABOX_API_KEY).
  private readonly hasComputer: boolean;
  // Set by the computer module: the user's cloud computer.
  private computerFor?: (userId: string) => ComputerActions;

  constructor(
    private readonly config: ConfigService,
    private readonly cencori: CencoriService,
    private readonly betterAuth: BetterAuthService,
    private readonly prisma: PrismaService,
    private readonly bullmq: BullmqService,
    private readonly r2: R2Service,
    private readonly usage: UsageService,
    private readonly approvals: ApprovalService,
    private readonly activity: ActivityService,
  ) {
    this.secrets = secretSettings
      .map((key) => this.config.get<string>(key))
      .filter((value): value is string => Boolean(value));
    this.hasComputer = Boolean(this.config.get<string>('INSTABOX_API_KEY'));
    this.agent = createChatAgent({
      secrets: this.secrets,
      computer: this.hasComputer,
      onHumanHandoff: ({ sessionId, reason }) =>
        this.logger.warn(`Chat ${sessionId} needs a person: ${reason}`),
    });
  }

  // The routine module hands over what the agent may do with routines.
  useRoutines(actions: RoutineActions): void {
    this.routineActions = actions;
  }

  // The bot module hands over how to load a user's bots.
  useBots(loader: BotLoader): void {
    this.bots = loader;
  }

  // The group module hands over how to load a user's group.
  useGroups(
    load: (userId: string, groupId: string) => Promise<GroupRuntime>,
  ): void {
    this.groups = load;
  }

  // The document module hands over how to search a user's documents.
  useDocuments(
    search: (userId: string, query: string) => Promise<string>,
  ): void {
    this.documentSearch = search;
  }

  // The computer module hands over the user's cloud computer.
  useComputer(computerFor: (userId: string) => ComputerActions): void {
    this.computerFor = computerFor;
  }

  // The plan module hands over how to start a plan.
  usePlans(
    start: (userId: string, goal: string) => Promise<{ id: string }>,
  ): void {
    this.planStarter = start;
  }

  // Which agent answers: the user's group or bot when the chat is with one,
  // else the default assistant. A chat keeps what it started with.
  private async agentFor(
    userId: string,
    body: Pick<ChatRequestDto, 'sessionId' | 'botId' | 'groupId'>,
  ): Promise<{
    agent: Agent<ChatContext>;
    bot?: BotRuntime;
    group?: { id: string; said: GroupSaid[] };
  }> {
    let { botId, groupId } = body;
    if (body.sessionId) {
      const chat = await this.prisma.db.chatSession.findUnique({
        where: { id: body.sessionId },
      });
      if (chat?.userId === userId) {
        botId = chat.botId ?? undefined;
        groupId = chat.groupId ?? undefined;
      }
    }
    if (groupId) return this.groupAgent(userId, groupId);
    if (!botId) return { agent: await this.assistantFor(userId) };
    return this.botAgent(userId, botId);
  }

  // A group chat: a lead asks the group's bots, and they may ask each other.
  // Every answer a bot gives is kept in "said" for the chat history.
  private async groupAgent(
    userId: string,
    groupId: string,
  ): Promise<{
    agent: Agent<ChatContext>;
    group: { id: string; said: GroupSaid[] };
  }> {
    if (!this.groups) throw new NotFoundException('Group not found.');
    const group = await this.groups(userId, groupId);
    const said: GroupSaid[] = [];
    let asks = 0;

    // canAskOthers: a bot asked by the lead may ask the other bots; a bot
    // asked by another bot may not, so questions never go round in circles.
    const askFrom =
      (canAskOthers: boolean): AskBot =>
      async (name, question, context) => {
        const member = group.members.find((bot) => bot.name === name);
        if (!member) return `There is no bot named "${name}" in this group.`;
        if (++asks > maxGroupAsks) {
          return 'The bots have been asked enough for this message. Answer with what you have.';
        }
        const agent = createBotAgent(
          { secrets: this.secrets },
          { ...member, computer: this.hasComputer },
          {
            others: canAskOthers
              ? group.members.filter((bot) => bot.name !== name)
              : [],
            ask: askFrom(false),
          },
        );
        try {
          const result = await this.cencori.agentRun(agent, question, {
            context,
            user: userId,
            metadata: { userId, groupId },
            maxTurns: maxGroupBotTurns,
          });
          // The bot's side talk lives in its own Cencori session; we keep
          // what it said, so that session is removed.
          await this.bullmq
            .add(deleteAtCencori, { sessionId: result.sessionId })
            .catch(() => undefined);
          const text =
            result.interruptions.length > 0
              ? `${name} needs the user's approval for a step, which is not possible inside a group. Ask the user to do this with ${name} directly.`
              : typeof result.finalOutput === 'string'
                ? result.finalOutput
                : '';
          said.push({ bot: name, text, at: new Date() });
          return text || `${name} had nothing to say.`;
        } catch {
          this.logger.warn(`Bot ${member.id} failed inside group ${groupId}.`);
          return `${name} could not answer right now.`;
        }
      };

    return {
      agent: createGroupAgent({ secrets: this.secrets }, group, askFrom(true)),
      group: { id: group.id, said },
    };
  }

  private async botAgent(
    userId: string,
    botId: string,
  ): Promise<{ agent: Agent<ChatContext>; bot: BotRuntime }> {
    if (!this.bots) throw new NotFoundException('Bot not found.');
    const bot = await this.bots.one(userId, botId);
    return {
      agent: createBotAgent(
        { secrets: this.secrets },
        { ...bot, computer: this.hasComputer },
      ),
      bot,
    };
  }

  // The orchestrator for one user: the default assistant, able to hand the
  // chat to that user's own bots (by their description) as well as to its
  // built-in helpers.
  private async assistantFor(userId: string): Promise<Agent<ChatContext>> {
    const bots = (await this.bots?.forAssistant(userId)) ?? [];
    if (bots.length === 0) return this.agent;
    const taken = new Set(this.agent.handoffs.map((agent) => agent.name));
    const own = bots
      // Handoffs go by name, so a second bot with the same name is skipped.
      .filter((bot) => !taken.has(bot.name) && taken.add(bot.name))
      .map((bot) =>
        createBotAgent(
          { secrets: this.secrets },
          { ...bot, computer: this.hasComputer },
        ),
      );
    if (own.length === 0) return this.agent;
    // Naming the bots in the instructions makes the assistant actually use
    // them, instead of doing a bot's job itself.
    const list = own
      .map((bot) => `- ${bot.name}: ${bot.handoffDescription}`)
      .join('\n');
    return this.agent.clone({
      handoffs: [...this.agent.handoffs, ...own],
      instructions: async (runContext) =>
        `${await this.agent.resolveInstructions(runContext)}\n\n` +
        `The user's own bots:\n${list}\n` +
        'When a request matches one of these bots, you must hand the chat ' +
        'to it. Do not answer it yourself and do not use write_text for it.',
    });
  }

  onModuleInit(): void {
    this.bullmq.handle<{ keys?: string[]; prefix?: string }>(
      deleteFilesJob,
      async ({ keys, prefix }) => {
        if (keys) await this.r2.remove(keys);
        if (prefix) await this.r2.removePrefix(prefix);
      },
    );
    this.bullmq.handle<{ sessionId: string }>(
      deleteAtCencori,
      async ({ sessionId }) => {
        if (!this.cencori.isConfigured) return;
        await this.cencori.sessionsDelete(sessionId);
      },
    );
  }

  // Runs one chat turn and streams it to the browser.
  async send(
    body: ChatRequestDto,
    auth: AuthSession,
    request: ExpressRequest,
    response: Response,
  ): Promise<void> {
    const userId = auth.user.id;
    const headers = fromNodeHeaders(request.headers);
    const abort = new AbortController();
    response.on('close', () => abort.abort());

    // Polls only read what a person wrote; everything else uses the AI.
    if (!body.poll) await this.usage.assertAllowance(userId);
    const { agent, bot, group } = await this.agentFor(userId, body);
    const { botId: _botId, groupId: _groupId, ...turn } = body;
    const rules = await this.approvals.rulesFor(userId);
    // The user answered an approval card (here or from the inbox).
    if (turn.approval) {
      const resolved = await this.approvals.resolve(
        userId,
        turn.approval.state,
        turn.approval.decisions,
      );
      if (!resolved) throw new NotFoundException('Approval not found.');
    }
    // A bot with app connections (Gmail...) starts its chat in a session
    // that carries them, so Cencori can offer those tools.
    if (bot?.cencori && !turn.sessionId && !turn.approval && !turn.poll) {
      turn.sessionId = await this.startBotSession(userId, bot, turn);
    }
    // A reply to an earlier message: the AI is shown what is quoted.
    const quoted = turn.replyTo ? await this.quoted(userId, turn) : undefined;
    // Files are saved while the model answers, so they never slow the chat.
    const files = this.storeFiles(userId, turn.attachments ?? []);
    // The model gets small pictures enlarged, so it reads them right. The
    // stored file stays the original.
    if (turn.attachments?.length) {
      turn.attachments = await Promise.all(
        turn.attachments.map(async (file) =>
          file.kind === 'image'
            ? { ...file, data_url: await readableImage(file.data_url) }
            : file,
        ),
      );
    }
    const handler = this.cencori.agentChatHandler(agent, {
      context: () =>
        this.context(auth.user, headers, {
          rules,
          botId: bot?.id,
          chatId: turn.sessionId,
        }),
      user: () => userId,
      authorizeSession: (sessionId) => this.owns(sessionId, userId),
      // Signs paused runs (approvals) so the browser can't change them.
      secret: this.config.getOrThrow<string>('BETTER_AUTH_SECRET'),
      // The default assistant: Cencori remembers facts about this user
      // across chats. A bot keeps its own memories instead (see BotParts),
      // so one bot's facts never reach another.
      ...(bot || group ? {} : { memory: { userId } }),
      metadata: group ? { userId, groupId: group.id } : { userId },
      maxTurns: maxAgentTurns,
    });

    const answer = await handler(
      new Request(new URL(request.originalUrl, 'http://localhost'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...turn,
          replyTo: undefined,
          ...(quoted && turn.message
            ? { message: `${quoted}\n\n${turn.message}` }
            : {}),
        }),
        signal: abort.signal,
      }),
    );

    response.status(answer.status);
    answer.headers.forEach((value, key) => response.setHeader(key, value));
    if (!answer.body) {
      response.end();
      return;
    }
    // Polls and errors answer JSON; only real chat turns are saved.
    const isStream = answer.headers
      .get('content-type')
      ?.includes('text/event-stream');
    const stream = isStream
      ? answer.body.pipeThrough(
          this.recordTurn(userId, turn, bot?.id, files, group),
        )
      : answer.body;
    Readable.fromWeb(stream as NodeReadableStream).pipe(response);
  }

  // The user's chats, newest first, one small page at a time. Paging
  // follows the index, so it stays fast however many chats there are.
  list(
    auth: AuthSession,
    query: ChatHistoryQueryDto,
  ): Promise<ChatSessionDto[]> {
    return this.prisma.db.chatSession.findMany({
      where: { userId: auth.user.id },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
  }

  async remove(sessionId: string, auth: AuthSession): Promise<void> {
    if (!(await this.owns(sessionId, auth.user.id))) {
      throw new NotFoundException('Chat not found.');
    }
    const withFiles = await this.prisma.db.chatMessage.findMany({
      where: { sessionId, NOT: { attachments: { equals: Prisma.DbNull } } },
      select: { attachments: true },
    });
    const keys = withFiles.flatMap((message) =>
      storedFiles(message.attachments).flatMap((file) =>
        file.key ? [file.key] : [],
      ),
    );
    // Queue remote cleanup first. If Redis is down, the local chat stays so
    // the request can be retried instead of stranding an external copy.
    await this.bullmq.add(
      deleteAtCencori,
      { sessionId },
      { jobId: `delete-${sessionId}` },
    );
    if (keys.length > 0) await this.bullmq.add(deleteFilesJob, { keys });
    await this.prisma.db.chatSession.delete({ where: { id: sessionId } });
  }

  // A chat's messages from our own database, newest page first.
  async messages(
    sessionId: string,
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    query: ChatHistoryQueryDto,
  ): Promise<ChatHistoryMessageDto[]> {
    if (!(await this.owns(sessionId, auth.user.id))) {
      await this.authorizeStaff(auth, headers, 'read');
      await this.exists(sessionId);
    }
    // The cursor makes sure "before" is a message of this chat.
    if (query.before) {
      const cursor = await this.prisma.db.chatMessage.findFirst({
        where: { id: query.before, sessionId },
        select: { id: true },
      });
      if (!cursor) throw new NotFoundException('Message not found.');
    }
    const rows = await this.prisma.db.chatMessage.findMany({
      where: { sessionId },
      include: {
        replyTo: { select: { id: true, role: true, agent: true, text: true } },
        reactions: { where: { userId: auth.user.id }, select: { emoji: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
    // Oldest first, ready to show.
    return Promise.all(
      rows.reverse().map(async (row) => ({
        id: row.id,
        role: row.role as ChatHistoryMessageDto['role'],
        agent: row.agent,
        text: row.text,
        widgets: (row.widgets as Record<string, unknown>[] | null) ?? [],
        followUps: Array.isArray(row.followUps)
          ? (row.followUps as string[])
          : [],
        reaction: row.reactions[0]?.emoji ?? null,
        replyTo: row.replyTo
          ? {
              id: row.replyTo.id,
              role: row.replyTo.role as ChatHistoryMessageDto['role'],
              agent: row.replyTo.agent,
              text: row.replyTo.text.slice(0, 200),
            }
          : null,
        // Each file gets a private link that works for 15 minutes.
        attachments: await Promise.all(
          storedFiles(row.attachments).map(async (file) => ({
            name: file.name,
            kind: file.kind,
            url: file.key
              ? await this.r2.link(file.key, {
                  name: file.name,
                  contentType: file.contentType,
                })
              : null,
          })),
        ),
        createdAt: row.createdAt,
      })),
    );
  }

  // Who handles the chat, and what a person said. The owner or staff.
  async status(
    sessionId: string,
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    after?: string,
  ): Promise<ChatStatusDto> {
    if (!(await this.owns(sessionId, auth.user.id))) {
      await this.authorizeStaff(auth, headers, 'read');
      await this.exists(sessionId);
    }
    return this.cencori.agentHumanStatus(sessionId, after);
  }

  // Staff answer a chat the agent handed over.
  async reply(
    sessionId: string,
    text: string,
    auth: AuthSession,
    headers: IncomingHttpHeaders,
  ): Promise<ChatStatusDto['messages'][number]> {
    await this.authorizeStaff(auth, headers, 'reply');
    await this.exists(sessionId);
    const message = await this.cencori.agentHumanReply(sessionId, text);
    await this.prisma.db.chatMessage.create({
      data: { id: randomUUID(), sessionId, role: 'human', text },
    });
    return message;
  }

  // Staff hand the chat back to the agent.
  async release(
    sessionId: string,
    auth: AuthSession,
    headers: IncomingHttpHeaders,
  ): Promise<void> {
    await this.authorizeStaff(auth, headers, 'reply');
    await this.exists(sessionId);
    await this.cencori.agentReleaseToAgent(sessionId);
  }

  // Runs a routine's prompt for its owner and saves the run as a new chat.
  async runRoutine(routine: {
    id: string;
    userId: string;
    name: string;
    prompt: string;
    botId?: string | null;
  }): Promise<RoutineRunStatus> {
    const result = await this.ask(routine.userId, {
      message: routine.prompt,
      botId: routine.botId ?? undefined,
      title: routine.name,
      routineId: routine.id,
      stopNote: 'This routine stopped',
    });
    return result.needsApproval ? 'needs-approval' : 'ok';
  }

  // One message, answered in full (no stream) and saved like any chat turn.
  // For work with no browser watching: routines, and AI apps on our MCP
  // server. Continues a chat when chatId is given; else starts one with the
  // default assistant, a bot or a group.
  async ask(userId: string, input: AskInput): Promise<AskResult> {
    const turn = await this.startAsk(userId, input);
    const result = await this.cencori.agentRun(
      turn.agent,
      input.message,
      turn.options,
    );
    return this.finishAsk(turn, input, result);
  }

  // The same, but the answer is given piece by piece as it is written, so a
  // voice call can start speaking at once. The turn is saved when the answer
  // ends, also when the listener stops early (the user talked over it).
  async *askStream(
    userId: string,
    input: AskInput & { onSaved?: (result: AskResult) => void },
  ): AsyncGenerator<string, void, void> {
    const turn = await this.startAsk(userId, input);
    const streamed = this.cencori.agentRunStream(
      turn.agent,
      input.message,
      turn.options,
    );
    // Read by hand (not for-await): stopping a for-await early would end
    // the run without ever reporting its result.
    const events = streamed[Symbol.asyncIterator]();
    let ended = false;
    try {
      while (true) {
        const step = await events.next();
        if (step.done) {
          ended = true;
          break;
        }
        const event = step.value;
        if (event.type === 'text_delta' && event.delta) yield event.delta;
      }
    } finally {
      // Cut short: let the bot finish its answer unheard, so the turn is
      // whole in the history and the chat can carry on.
      while (!ended) ended = (await events.next()).done === true;
      const result = await streamed.completed;
      input.onSaved?.(await this.finishAsk(turn, input, result));
    }
  }

  // Checks who is asking and picks the agent and its run options.
  private async startAsk(userId: string, input: AskInput) {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found.');
    if (input.chatId && !(await this.owns(input.chatId, userId))) {
      throw new NotFoundException('Chat not found.');
    }
    await this.usage.assertAllowance(userId);
    const rules = await this.approvals.rulesFor(userId);
    const { agent, bot, group } = await this.agentFor(userId, {
      sessionId: input.chatId,
      botId: input.botId,
      groupId: input.groupId,
    });
    const speaker = input.spoken
      ? agent.clone({
          instructions: async (runContext) =>
            `${(await agent.resolveInstructions(runContext)) ?? ''}\n\n` +
            'This is a live voice call: your answer is read aloud. Speak ' +
            'like a person on the phone: one to three short sentences, no ' +
            'lists, no headings, no symbols, no widgets. Offer to send ' +
            'long things (like a full email) in the chat instead.',
          widgets: false,
        })
      : agent;
    return {
      user,
      bot,
      group,
      startedAt: new Date(),
      agent: speaker,
      options: {
        context: this.context(user, undefined, {
          rules,
          botId: bot?.id,
          chatId: input.chatId,
        }),
        user: user.id,
        sessionId: input.chatId,
        ...(bot || group ? {} : { memory: { userId: user.id } }),
        metadata: {
          userId: user.id,
          ...(input.routineId && { routineId: input.routineId }),
          ...(group && { groupId: group.id }),
          ...(input.spoken && { kind: 'voice' }),
          ...(input.source === 'plan' && { kind: 'plan' }),
        },
        maxTurns: maxAgentTurns,
      },
    };
  }

  // Saves the turn in our database and says how it went.
  private async finishAsk(
    turn: Awaited<ReturnType<ChatService['startAsk']>>,
    input: AskInput,
    result: Awaited<ReturnType<CencoriService['agentRun']>>,
  ): Promise<AskResult> {
    const db = this.prisma.db;
    const { user, bot, group } = turn;
    const needsApproval = result.interruptions.length > 0;
    const answer =
      typeof result.finalOutput === 'string'
        ? result.finalOutput
        : result.newItems
            .flatMap((item) => (item.type === 'message' ? [item.text] : []))
            .join('\n\n');
    const widgets = result.newItems.flatMap((item) =>
      item.type === 'widget' ? [item.widget] : [],
    );
    const waiting = result.interruptions.map((item) => item.toolName);
    // The agent quoted an earlier message, or offered next steps.
    const said = result.newItems.reduce<ReturnType<typeof agentToolArgs>>(
      (found, item) =>
        item.type === 'tool_call'
          ? { ...found, ...agentToolArgs(item.toolName, item.arguments) }
          : found,
      {},
    );
    const quote = said.quote;
    const agentReplyTo = quote
      ? await this.findQuoted(result.sessionId, quote)
      : null;
    // Nobody is there to approve a step, so say what is waiting.
    const text = needsApproval
      ? `${answer}\n\n${input.stopNote ?? 'This stopped'}: ${waiting.join(', ')} needs your approval. Approve it from your approvals inbox.`.trim()
      : answer;

    await db.$transaction([
      db.chatSession.upsert({
        where: { id: result.sessionId },
        create: {
          id: result.sessionId,
          userId: user.id,
          title: (input.title ?? input.message).slice(0, 80),
          routineId: input.routineId,
          botId: bot?.id,
          groupId: group?.id,
        },
        update: { updatedAt: new Date() },
      }),
      db.chatMessage.createMany({
        data: [
          {
            id: randomUUID(),
            sessionId: result.sessionId,
            role: 'user',
            text: input.message,
            createdAt: turn.startedAt,
          },
          // In a group: what each bot said, before the lead's answer.
          ...(group?.said ?? [])
            .filter((said) => said.text)
            .map((said) => ({
              id: randomUUID(),
              sessionId: result.sessionId,
              role: 'agent',
              agent: said.bot,
              text: said.text,
              createdAt: said.at,
            })),
          {
            id: randomUUID(),
            sessionId: result.sessionId,
            role: 'agent',
            agent: result.lastAgent.name,
            text,
            widgets: widgets as never,
            replyToId: agentReplyTo,
            followUps: (said.followUps ?? null) as never,
          },
        ],
      }),
    ]);
    this.logTools(user.id, result.newItems);
    if (bot && !group) this.queueLearning(result.sessionId);
    // Nobody was there to approve: the steps wait in the inbox, signed like
    // a chat's, so approving them carries the run on in this chat.
    if (needsApproval && result.state) {
      await this.approvals.recordPending({
        userId: user.id,
        chatId: result.sessionId,
        botId: bot?.id,
        source: input.source ?? (input.routineId ? 'routine' : 'chat'),
        items: result.interruptions.map((item) => ({
          callId: item.callId,
          toolName: item.toolName,
          arguments: item.arguments,
          agentName: item.agentName,
        })),
        state: signRunState(
          result.state,
          this.config.getOrThrow<string>('BETTER_AUTH_SECRET'),
        ),
      });
    }
    return {
      chatId: result.sessionId,
      answeredBy: result.lastAgent.name,
      answer: text,
      needsApproval,
      followUps: said.followUps ?? [],
    };
  }

  // Each tool the AI ran goes in the user's activity log.
  private logTools(
    userId: string,
    items: { type: string; toolName?: string; agentName?: string }[],
  ): void {
    for (const item of items) {
      if (item.type !== 'tool_output' || !item.toolName) continue;
      this.activity.log({
        userId,
        actor: `agent:${item.agentName ?? 'unknown'}`,
        action: 'tool.ran',
        target: item.toolName,
      });
    }
  }

  // What the agent's tools can see and do, as the user. Without headers (a
  // routine, no browser) changes that need the user's session are refused.
  private context(
    user: ChatUser,
    headers?: Headers,
    where: {
      rules: ToolRuleView[];
      botId?: string;
      chatId?: string;
    } = { rules: [] },
  ): ChatContext {
    return {
      toolDecision: (tool) =>
        decideTool(where.rules, tool, {
          botId: where.botId,
          chatId: where.chatId,
        }),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
      organizations: async () => {
        const members = await this.prisma.db.member.findMany({
          where: { userId: user.id },
          include: { organization: true },
        });
        return members.map((member) => ({
          id: member.organization.id,
          name: member.organization.name,
          slug: member.organization.slug,
          role: member.role,
        }));
      },
      // Through Better Auth as the user, so its own checks apply.
      rename: async (name) => {
        if (!headers)
          throw new Error('Name changes need a chat, not a routine.');
        await this.betterAuth.auth.api.updateUser({ headers, body: { name } });
      },
      routines: this.routinesFor(user.id),
      searchDocuments: (query) =>
        this.documentSearch
          ? this.documentSearch(user.id, query)
          : Promise.resolve('Documents are not available.'),
      computer: this.computerFor?.(user.id),
      startPlan: (goal) => {
        if (!this.planStarter) throw new Error('Plans are not available.');
        return this.planStarter(user.id, goal);
      },
    };
  }

  // Opens the Cencori session a bot chat runs in, tied to the bot's
  // connections, and records the chat as the user's before the first turn.
  private async startBotSession(
    userId: string,
    bot: BotRuntime,
    body: ChatRequestDto,
  ): Promise<string | undefined> {
    if (!bot.cencori) return undefined;
    try {
      const session = await this.cencori.sessionsCreate({
        agent_id: bot.cencori.agentId,
        tenant_id: bot.cencori.tenantId,
        external_user_id: userId,
        installation_id: bot.cencori.installationId,
      });
      const title = (body.message ?? body.action?.label ?? '').trim();
      await this.prisma.db.chatSession.create({
        data: {
          id: session.id,
          userId,
          title: title.slice(0, 80) || 'New chat',
          botId: bot.id,
        },
      });
      return session.id;
    } catch {
      // The chat still works, without the app tools.
      this.logger.warn(`Bot ${bot.id} could not open its app session.`);
      return undefined;
    }
  }

  // Keeps the files a user attached, so they can be opened from the chat
  // history later. A file that cannot be stored is kept by name only; the
  // chat itself is never held up or failed by storage.
  private async storeFiles(
    userId: string,
    attachments: NonNullable<ChatRequestDto['attachments']>,
  ): Promise<StoredFile[]> {
    const folder = `${userFilesPrefix(userId)}${randomUUID()}/`;
    return Promise.all(
      attachments.map(async (file, index): Promise<StoredFile> => {
        const base = { name: file.name, kind: file.kind };
        const parsed = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(file.data_url);
        const contentType = parsed?.[1] || 'application/octet-stream';
        if (!parsed) return { ...base, contentType };
        try {
          const bytes = parsed[2]
            ? Buffer.from(parsed[3], 'base64')
            : Buffer.from(decodeURIComponent(parsed[3]));
          if (bytes.length === 0 || bytes.length > maxFileBytes) {
            return { ...base, contentType };
          }
          const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-100);
          const key = `${folder}${index}-${safeName || 'file'}`;
          await this.r2.put(key, bytes, contentType);
          return { ...base, contentType, key, size: bytes.length };
        } catch {
          this.logger.warn('A chat file could not be stored.');
          return { ...base, contentType };
        }
      }),
    );
  }

  private routinesFor(userId: string): ChatContext['routines'] {
    const actions = () => {
      if (!this.routineActions) throw new Error('Routines are not available.');
      return this.routineActions;
    };
    return {
      list: () => actions().list(userId),
      create: (input) => actions().create(userId, input),
      setEnabled: (id, enabled) => actions().setEnabled(userId, id, enabled),
      remove: (id) => actions().remove(userId, id),
    };
  }

  private async owns(sessionId: string, userId: string): Promise<boolean> {
    const chat = await this.prisma.db.chatSession.findUnique({
      where: { id: sessionId },
    });
    return chat?.userId === userId;
  }

  private async exists(sessionId: string): Promise<void> {
    const chat = await this.prisma.db.chatSession.findUnique({
      where: { id: sessionId },
    });
    if (!chat) throw new NotFoundException('Chat not found.');
  }

  // Reads the stream as it passes and saves the turn in our database: who
  // owns the chat, what the user sent and what the agent answered. Saved
  // before the browser sees the end, so its next request already finds it.
  private recordTurn(
    userId: string,
    body: ChatRequestDto,
    botId?: string,
    files: Promise<StoredFile[]> = Promise.resolve([]),
    group?: { id: string; said: GroupSaid[] },
  ): TransformStream<Uint8Array, Uint8Array> {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const startedAt = new Date();
    const userText = (body.message ?? body.action?.label ?? '').trim();
    const hasFiles = (body.attachments ?? []).length > 0;
    let buffer = '';
    let text = '';
    let agent: string | undefined;
    const widgets: unknown[] = [];
    let saved = false;
    // Words the agent quoted (reply_to_message), and the ids it saved.
    let agentQuote: string | undefined;
    let followUps: string[] | undefined;
    let savedIds: {
      userMessageId?: string;
      agentMessageId?: string;
      followUps?: string[];
    } | null = null;

    const save = async (sessionId: string) => {
      if (saved) return;
      saved = true;
      const db = this.prisma.db;
      await db.chatSession.upsert({
        where: { id: sessionId },
        create: {
          id: sessionId,
          userId,
          title: userText.slice(0, 80) || 'New chat',
          botId,
          groupId: group?.id,
        },
        update: { updatedAt: new Date() },
      });
      const rows = [];
      const ids: {
        userMessageId?: string;
        agentMessageId?: string;
        followUps?: string[];
      } = followUps ? { followUps } : {};
      const agentReplyTo = agentQuote
        ? await this.findQuoted(sessionId, agentQuote)
        : null;
      if (userText || hasFiles) {
        ids.userMessageId = randomUUID();
        rows.push({
          id: ids.userMessageId,
          sessionId,
          role: 'user',
          text: userText,
          attachments: (await files) as never,
          replyToId: body.replyTo ?? null,
          createdAt: startedAt,
        });
      }
      // In a group: what each bot said, in order, before the lead's answer.
      for (const turn of group?.said ?? []) {
        if (!turn.text) continue;
        rows.push({
          id: randomUUID(),
          sessionId,
          role: 'agent',
          agent: turn.bot,
          text: turn.text,
          createdAt: turn.at,
        });
      }
      if (text || widgets.length > 0) {
        ids.agentMessageId = randomUUID();
        rows.push({
          id: ids.agentMessageId,
          sessionId,
          role: 'agent',
          agent,
          text,
          widgets: widgets as never,
          replyToId: agentReplyTo,
          followUps: (followUps ?? null) as never,
        });
      }
      if (rows.length > 0) await db.chatMessage.createMany({ data: rows });
      savedIds = ids;
      if (botId && !group) this.queueLearning(sessionId);
    };

    const read = async (event: string): Promise<string | undefined> => {
      const { name, data } = parseEvent(event);
      if (name === 'tool_call' && typeof data.arguments === 'string') {
        const said = agentToolArgs(String(data.name), data.arguments);
        agentQuote = said.quote ?? agentQuote;
        followUps = said.followUps ?? followUps;
      }
      if (name === 'text' && typeof data.delta === 'string') {
        text += data.delta;
        if (typeof data.agent === 'string') agent = data.agent;
      } else if (name === 'widget' && data.widget) {
        widgets.push(data.widget);
      } else if (name === 'tool_output' && typeof data.name === 'string') {
        this.activity.log({
          userId,
          actor: `agent:${typeof data.agent === 'string' ? data.agent : 'unknown'}`,
          action: 'tool.ran',
          target: data.name,
        });
      }
      if (
        name === 'approval' &&
        typeof data.sessionId === 'string' &&
        typeof data.state === 'string' &&
        Array.isArray(data.items)
      ) {
        await this.approvals.recordPending({
          userId,
          chatId: data.sessionId,
          botId,
          source: 'chat',
          items: data.items as PendingApprovalItemDto[],
          state: data.state,
        });
      }
      if (
        (name === 'done' || name === 'approval') &&
        typeof data.sessionId === 'string'
      ) {
        await save(data.sessionId);
      }
      return name;
    };

    return new TransformStream({
      transform: async (chunk, controller) => {
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        // Each finished event goes to the browser right away. Only the final
        // "done" waits for the save (a few ms, after all text is shown).
        for (const event of events) {
          let name: string | undefined;
          try {
            name = await read(event);
          } catch {
            this.logger.error('A chat turn could not be saved.');
          }
          // Once saved, the app learns the new messages' ids, so the user
          // can reply to them straight away.
          if ((name === 'done' || name === 'approval') && savedIds) {
            controller.enqueue(
              encoder.encode(
                `event: saved\ndata: ${JSON.stringify(savedIds)}\n\n`,
              ),
            );
            savedIds = null;
          }
          controller.enqueue(
            encoder.encode(
              `${name === 'approval' ? withApprovalCards(event) : event}\n\n`,
            ),
          );
        }
      },
      // The stream ended early (an error, or a person has the chat): keep
      // what we have when we know which chat it is.
      flush: async (controller) => {
        if (buffer) controller.enqueue(encoder.encode(buffer));
        if (!body.sessionId) return;
        try {
          await save(body.sessionId);
        } catch {
          this.logger.error('A chat turn could not be saved.');
        }
      },
    });
  }

  // After a bot chat, the bot learns from it in the background (see the bot
  // module). One run per chat per quarter hour, after the chat goes quiet.
  private queueLearning(sessionId: string): void {
    const slot = Math.floor(Date.now() / learnEveryMs);
    this.bullmq
      .add(
        learnFromChatJob,
        { sessionId },
        {
          jobId: `learn-${sessionId}-${slot}`,
          delayMs: learnDelayMs,
          attempts: 2,
        },
      )
      .catch(() => this.logger.warn('Learning was not queued.'));
  }

  // The user reacts to a message with an emoji (or clears it with null).
  async react(
    sessionId: string,
    messageId: string,
    auth: AuthSession,
    emoji: string | null,
  ): Promise<void> {
    const userId = auth.user.id;
    const message = await this.prisma.db.chatMessage.findFirst({
      where: { id: messageId, sessionId, session: { userId } },
      select: { id: true },
    });
    if (!message) throw new NotFoundException('Message not found.');
    if (emoji === null) {
      await this.prisma.db.messageReaction.deleteMany({
        where: { messageId, userId },
      });
      return;
    }
    await this.prisma.db.messageReaction.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId, emoji },
      update: { emoji, createdAt: new Date() },
    });
  }

  // The line the AI sees above a reply: what the user quoted.
  private async quoted(userId: string, turn: ChatRequestDto): Promise<string> {
    if (!turn.sessionId) {
      throw new BadRequestException('A reply needs the chat (sessionId).');
    }
    const message = await this.prisma.db.chatMessage.findFirst({
      where: {
        id: turn.replyTo,
        sessionId: turn.sessionId,
        session: { userId },
      },
      select: { role: true, text: true, widgets: true },
    });
    if (!message) throw new NotFoundException('Message not found.');
    const text =
      message.text.trim().slice(0, 1000) ||
      (message.widgets ? '(a card or list)' : '(a file)');
    const whose =
      message.role === 'user'
        ? 'my earlier message'
        : message.role === 'human'
          ? 'a message from your team'
          : 'your earlier answer';
    return `[Replying to ${whose}: "${text.replace(/\s+/g, ' ')}"]`;
  }

  // The latest message of a chat that contains these words, for an agent's
  // quoted reply. Null when none does (the reply is then shown plainly).
  private async findQuoted(
    sessionId: string,
    quote: string,
  ): Promise<string | null> {
    const wanted = quote.toLowerCase().replace(/\s+/g, ' ').trim();
    if (wanted.length < 3) return null;
    const recent = await this.prisma.db.chatMessage.findMany({
      where: { sessionId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      select: { id: true, text: true },
    });
    return (
      recent.find((message) =>
        message.text.toLowerCase().replace(/\s+/g, ' ').includes(wanted),
      )?.id ?? null
    );
  }

  // Platform admins, or staff whose role has the chat permission.
  private authorizeStaff(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    permission: 'read' | 'reply',
  ): Promise<void> {
    return assertStaff(
      { betterAuth: this.betterAuth, prisma: this.prisma },
      auth,
      headers,
      { chat: [permission] },
    );
  }
}

// What the agent said through its reply and follow-up tools.
export function agentToolArgs(
  toolName: string,
  argsJson: string,
): { quote?: string; followUps?: string[] } {
  if (toolName !== replyToMessageTool && toolName !== followUpsTool) return {};
  try {
    const args = JSON.parse(argsJson) as {
      quote?: unknown;
      suggestions?: unknown;
    };
    if (toolName === replyToMessageTool) {
      return typeof args.quote === 'string' ? { quote: args.quote } : {};
    }
    const list = Array.isArray(args.suggestions)
      ? args.suggestions
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim().slice(0, 80))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    return list.length > 0 ? { followUps: list } : {};
  } catch {
    return {};
  }
}

// An approval event with our fixed card added to each waiting step, so
// every app shows the same card (see config/agents/cards.ts).
function withApprovalCards(event: string): string {
  const { data } = parseEvent(event);
  if (!Array.isArray(data.items)) return event;
  return `event: approval\ndata: ${JSON.stringify({
    ...data,
    items: withCards(data.items as PendingApprovalItemDto[]),
  })}`;
}

// One stream event: its name and its JSON data.
export function parseEvent(event: string): {
  name?: string;
  data: Record<string, unknown>;
} {
  const name = /^event: (\w+)$/m.exec(event)?.[1];
  const raw = /^data: (.*)$/m.exec(event)?.[1];
  try {
    const data: unknown = raw ? JSON.parse(raw) : {};
    return {
      name,
      data:
        data && typeof data === 'object'
          ? (data as Record<string, unknown>)
          : {},
    };
  } catch {
    return { name, data: {} };
  }
}
