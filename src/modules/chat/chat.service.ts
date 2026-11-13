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
import { type ChatContext, createChatAgent } from '@/config/agents/agents.js';
import { maxAgentTurns } from '@/config/agents/limits.js';
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
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';

// Background job: remove a deleted chat's copy at Cencori (retried if down).
const deleteAtCencori = 'cencori-session-delete';

interface ChatUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

// A routine run's answer: done, or stopped at a step the user must approve.
export type RoutineRunStatus = 'ok' | 'needs-approval';

// Secrets the agent must never repeat (checked by its answer guardrail).
const secretSettings = [
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_API_KEY',
  'CENCORI_API_KEY',
  'RESEND_API_KEY',
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

  constructor(
    private readonly config: ConfigService,
    private readonly cencori: CencoriService,
    private readonly betterAuth: BetterAuthService,
    private readonly prisma: PrismaService,
    private readonly bullmq: BullmqService,
  ) {
    this.agent = createChatAgent({
      secrets: secretSettings
        .map((key) => this.config.get<string>(key))
        .filter((value): value is string => Boolean(value)),
      cencoriAgentId: this.config.get<string>('CENCORI_AGENT_ID'),
      mcpUrl: this.config.get<string>('AGENT_MCP_URL'),
      onHumanHandoff: ({ sessionId, reason }) =>
        this.logger.warn(`Chat ${sessionId} needs a person: ${reason}`),
    });
  }

  onModuleInit(): void {
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

    const handler = this.cencori.agentChatHandler(this.agent, {
      context: () => this.context(auth.user, headers),
      user: () => userId,
      authorizeSession: (sessionId) => this.owns(sessionId, userId),
      // Signs paused runs (approvals) so the browser can't change them.
      secret: this.config.getOrThrow<string>('BETTER_AUTH_SECRET'),
      // Cencori remembers facts about this user across chats.
      memory: { userId },
      metadata: { userId },
      maxTurns: maxAgentTurns,
    });

    const answer = await handler(
      new Request(new URL(request.originalUrl, 'http://localhost'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
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
      ? answer.body.pipeThrough(this.recordTurn(userId, body))
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
    // Our copy goes now; Cencori's in the background, retried if it is down.
    await this.prisma.db.chatSession.delete({ where: { id: sessionId } });
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
    return rows.reverse().map((row) => ({
      id: row.id,
      role: row.role as ChatHistoryMessageDto['role'],
      agent: row.agent,
      text: row.text,
      widgets: (row.widgets as Record<string, unknown>[] | null) ?? [],
      attachments: (row.attachments as string[] | null) ?? [],
      createdAt: row.createdAt,
    }));
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
  }): Promise<RoutineRunStatus> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: routine.userId },
    });
    if (!user) throw new NotFoundException('User not found.');
    const startedAt = new Date();

    const result = await this.cencori.agentRun(this.agent, routine.prompt, {
      context: this.context(user),
      user: user.id,
      memory: { userId: user.id },
      metadata: { userId: user.id, routineId: routine.id },
      maxTurns: maxAgentTurns,
    });

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
    const text = needsApproval
      ? `${answer}\n\nThis routine stopped: ${waiting.join(', ')} needs your approval. Ask for it in a chat.`.trim()
      : answer;

    await this.prisma.db.$transaction([
      this.prisma.db.chatSession.create({
        data: {
          id: result.sessionId,
          userId: user.id,
          title: routine.name.slice(0, 80),
          routineId: routine.id,
        },
      }),
      this.prisma.db.chatMessage.createMany({
        data: [
          {
            id: randomUUID(),
            sessionId: result.sessionId,
            role: 'user',
            text: routine.prompt,
            createdAt: startedAt,
          },
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
    return needsApproval ? 'needs-approval' : 'ok';
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
  ): TransformStream<Uint8Array, Uint8Array> {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const startedAt = new Date();
    const userText = (body.message ?? body.action?.label ?? '').trim();
    const attachments = (body.attachments ?? []).map((file) => file.name);
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
        },
        update: { updatedAt: new Date() },
      });
      const rows = [];
      if (userText || attachments.length > 0) {
        rows.push({
          id: randomUUID(),
          sessionId,
          role: 'user',
          text: userText,
          attachments,
          createdAt: startedAt,
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
