import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request as ExpressRequest, Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Agent } from 'cencori/agents';
import { type ChatContext, createChatAgent } from '@/config/agents/agents.js';
import { staffOrganizationSlug } from '@/config/auth/access.js';
import type { ChatRequestDto, ChatSessionDto, ChatStatusDto } from '@/dto';
import {
  type AuthSession,
  BetterAuthService,
} from '@/lib/better-auth/better-auth.service.js';
import { CencoriService } from '@/lib/cencori/cencori.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

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
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly agent: Agent<ChatContext>;

  constructor(
    private readonly config: ConfigService,
    private readonly cencori: CencoriService,
    private readonly betterAuth: BetterAuthService,
    private readonly prisma: PrismaService,
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
      context: () => this.context(auth, headers),
      user: () => userId,
      authorizeSession: (sessionId) => this.owns(sessionId, userId),
      // Signs paused runs (approvals) so the browser can't change them.
      secret: this.config.getOrThrow<string>('BETTER_AUTH_SECRET'),
      // Cencori remembers facts about this user across chats.
      memory: { userId },
      metadata: { userId },
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
    const title = (body.message ?? body.action?.label ?? 'New chat')
      .trim()
      .slice(0, 80);
    const tracked = answer.body.pipeThrough(
      this.recordSessions(userId, title || 'New chat'),
    );
    Readable.fromWeb(tracked as NodeReadableStream).pipe(response);
  }

  // The user's chats, newest first.
  list(auth: AuthSession): Promise<ChatSessionDto[]> {
    return this.prisma.db.chatSession.findMany({
      where: { userId: auth.user.id },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  async remove(sessionId: string, auth: AuthSession): Promise<void> {
    if (!(await this.owns(sessionId, auth.user.id))) {
      throw new NotFoundException('Chat not found.');
    }
    await this.cencori.sessionsDelete(sessionId);
    await this.prisma.db.chatSession.delete({ where: { id: sessionId } });
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
    return this.cencori.agentHumanReply(sessionId, text);
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

  // What the agent's tools can see and do, as the signed-in user.
  private context(auth: AuthSession, headers: Headers): ChatContext {
    return {
      user: {
        id: auth.user.id,
        name: auth.user.name,
        email: auth.user.email,
        image: auth.user.image,
      },
      organizations: async () => {
        const members = await this.prisma.db.member.findMany({
          where: { userId: auth.user.id },
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

  // Saves each chat's owner when the stream reports its session id, before
  // the browser sees it (so its next message is already allowed).
  private recordSessions(
    userId: string,
    title: string,
  ): TransformStream<Uint8Array, Uint8Array> {
    const decoder = new TextDecoder();
    let buffer = '';
    const record = async (sessionId: string) => {
      await this.prisma.db.chatSession.upsert({
        where: { id: sessionId },
        create: { id: sessionId, userId, title },
        update: { updatedAt: new Date() },
      });
    };
    return new TransformStream({
      transform: async (chunk, controller) => {
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          const sessionId = sessionIdOf(event);
          if (sessionId) await record(sessionId);
        }
        controller.enqueue(chunk);
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

// The session id in a "done" or "approval" stream event, if any.
export function sessionIdOf(event: string): string | undefined {
  const name = /^event: (\w+)$/m.exec(event)?.[1];
  if (name !== 'done' && name !== 'approval') return undefined;
  const data = /^data: (.*)$/m.exec(event)?.[1];
  if (!data) return undefined;
  try {
    const parsed = JSON.parse(data) as { sessionId?: unknown };
    return typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined;
  } catch {
    return undefined;
  }
}
