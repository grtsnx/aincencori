import {
  ForbiddenException,
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
  createBotAgent,
  createGroupAgent,
  createChatAgent,
  type RoutineActions,
} from '@/config/agents/agents.js';
import { deleteFilesJob, userFilesPrefix } from '@/config/agents/jobs.js';
import {
  maxAgentTurns,
  maxGroupAsks,
  maxGroupBotTurns,
} from '@/config/agents/limits.js';
import { staffOrganizationSlug } from '@/config/auth/access.js';
import type {
  ChatHistoryMessageDto,
  ChatHistoryQueryDto,
  ChatRequestDto,
  ChatSessionDto,
  ChatStatusDto,
} from '@/dto';
import {
  type AuthSession,
  BetterAuthService,
} from '@/lib/better-auth/better-auth.service.js';
import { CencoriService } from '@/lib/cencori/cencori.service.js';
import { Prisma } from '@/generated/prisma/client.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { readableImage } from '@/middleware';
import { R2Service } from '@/lib/r2/r2.service.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';

// Background job: remove a deleted chat's copy at Cencori (retried if down).
const deleteAtCencori = 'cencori-session-delete';

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
  stopNote?: string;
  // The answer will be read aloud (a voice call): short, no formatting.
  spoken?: boolean;
}

export interface AskResult {
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
  'LINKEDIN_CLIENT_SECRET',
  'RECAPTCHA_SECRET_KEY',
  'DATABASE_URL',
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
  private readonly secrets: string[];

  constructor(
    private readonly config: ConfigService,
    private readonly cencori: CencoriService,
    private readonly betterAuth: BetterAuthService,
    private readonly prisma: PrismaService,
    private readonly bullmq: BullmqService,
    private readonly r2: R2Service,
  ) {
    this.secrets = secretSettings
      .map((key) => this.config.get<string>(key))
      .filter((value): value is string => Boolean(value));
    this.agent = createChatAgent({
      secrets: this.secrets,
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
        const agent = createBotAgent({ secrets: this.secrets }, member, {
          others: canAskOthers
            ? group.members.filter((bot) => bot.name !== name)
            : [],
          ask: askFrom(false),
        });
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
    return { agent: createBotAgent({ secrets: this.secrets }, bot), bot };
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
      .map((bot) => createBotAgent({ secrets: this.secrets }, bot));
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

    const { agent, bot, group } = await this.agentFor(userId, body);
    const { botId: _botId, groupId: _groupId, ...turn } = body;
    // A bot with app connections (Gmail...) starts its chat in a session
    // that carries them, so Cencori can offer those tools.
    if (bot?.cencori && !turn.sessionId && !turn.approval && !turn.poll) {
      turn.sessionId = await this.startBotSession(userId, bot, turn);
    }
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
      context: () => this.context(auth.user, headers),
      user: () => userId,
      authorizeSession: (sessionId) => this.owns(sessionId, userId),
      // Signs paused runs (approvals) so the browser can't change them.
      secret: this.config.getOrThrow<string>('BETTER_AUTH_SECRET'),
      // The default assistant: Cencori remembers facts about this user
      // across chats. A bot keeps its own memories instead (see BotParts),
      // so one bot's facts never reach another.
      ...(bot || group ? {} : { memory: { userId } }),
      metadata: { userId },
      maxTurns: maxAgentTurns,
    });

    const answer = await handler(
      new Request(new URL(request.originalUrl, 'http://localhost'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(turn),
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
    // Our copy goes now; Cencori's and the files in the background, retried
    // if a service is down.
    await this.prisma.db.chatSession.delete({ where: { id: sessionId } });
    if (keys.length > 0) await this.bullmq.add(deleteFilesJob, { keys });
    await this.bullmq.add(
      deleteAtCencori,
      { sessionId },
      { jobId: `delete-${sessionId}` },
    );
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
        context: this.context(user),
        user: user.id,
        sessionId: input.chatId,
        ...(bot || group ? {} : { memory: { userId: user.id } }),
        metadata: {
          userId: user.id,
          ...(input.routineId && { routineId: input.routineId }),
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
    // Nobody is there to approve a step, so say what is waiting.
    const text = needsApproval
      ? `${answer}\n\n${input.stopNote ?? 'This stopped'}: ${waiting.join(', ')} needs your approval. Ask for it in a chat.`.trim()
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
          },
        ],
      }),
    ]);
    return {
      chatId: result.sessionId,
      answeredBy: result.lastAgent.name,
      answer: text,
      needsApproval,
    };
  }

  // What the agent's tools can see and do, as the user. Without headers (a
  // routine, no browser) changes that need the user's session are refused.
  private context(user: ChatUser, headers?: Headers): ChatContext {
    return {
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
      if (userText || hasFiles) {
        rows.push({
          id: randomUUID(),
          sessionId,
          role: 'user',
          text: userText,
          attachments: (await files) as never,
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
        rows.push({
          id: randomUUID(),
          sessionId,
          role: 'agent',
          agent,
          text,
          widgets: widgets as never,
        });
      }
      if (rows.length > 0) await db.chatMessage.createMany({ data: rows });
    };

    const read = async (event: string) => {
      const { name, data } = parseEvent(event);
      if (name === 'text' && typeof data.delta === 'string') {
        text += data.delta;
        if (typeof data.agent === 'string') agent = data.agent;
      } else if (name === 'widget' && data.widget) {
        widgets.push(data.widget);
      } else if (
        (name === 'done' || name === 'approval') &&
        typeof data.sessionId === 'string'
      ) {
        await save(data.sessionId);
      }
    };

    return new TransformStream({
      transform: async (chunk, controller) => {
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        // Each finished event goes to the browser right away. Only the final
        // "done" waits for the save (a few ms, after all text is shown).
        for (const event of events) {
          try {
            await read(event);
          } catch {
            this.logger.error('A chat turn could not be saved.');
          }
          controller.enqueue(encoder.encode(`${event}\n\n`));
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

  // Platform admins, or staff whose role has the chat permission.
  private async authorizeStaff(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    permission: 'read' | 'reply',
  ): Promise<void> {
    const isAdmin = (auth.user as { role?: string | null }).role
      ?.split(',')
      .includes('admin');
    if (isAdmin) return;
    const staff = await this.prisma.db.organization.findUnique({
      where: { slug: staffOrganizationSlug },
    });
    const result = staff
      ? await this.betterAuth.auth.api.hasPermission({
          headers: fromNodeHeaders(headers),
          body: {
            organizationId: staff.id,
            permissions: { chat: [permission] },
          },
        })
      : { success: false };
    if (!result.success) {
      throw new ForbiddenException('You are not allowed to do this.');
    }
  }
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
