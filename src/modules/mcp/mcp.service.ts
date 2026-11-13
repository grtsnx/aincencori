import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requireMcpAuth } from '@better-auth/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { z } from 'zod';
import {
  type AuthSession,
  BetterAuthService,
} from '@/lib/better-auth/better-auth.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { ChatService } from '../chat/chat.service.js';
import { RoutineService } from '../routine/routine.service.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const page = {
  limit: z.number().int().min(1).max(100).optional(),
  before: z
    .string()
    .max(200)
    .optional()
    .describe('For the next page: the id of the last item you have'),
};

// Our MCP server: outside AI apps (Claude, Cursor, any MCP client) use the
// signed-in user's own services through it: profile, organizations, routines
// and chats. Admin and staff features are never offered here.
// A user signs the app in through Better Auth (OAuth); each call then runs
// as that user, so it can only touch that user's data.
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  private readonly protectedHandler: (request: Request) => Promise<Response>;

  constructor(
    config: ConfigService,
    betterAuth: BetterAuthService,
    private readonly prisma: PrismaService,
    private readonly routines: RoutineService,
    private readonly chats: ChatService,
  ) {
    // Checks the access token; without a valid one the app is told where to
    // sign in (401 with a WWW-Authenticate header).
    this.protectedHandler = requireMcpAuth(
      betterAuth.auth,
      async (request, claims) => {
        if (typeof claims.sub !== 'string') {
          return Response.json({ message: 'Unknown user.' }, { status: 401 });
        }
        // One short-lived server per request: nothing is kept in memory, so
        // any API server can answer any call.
        const server = this.serverFor(claims.sub);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await server.connect(transport);
        return transport.handleRequest(request);
      },
      // The address MCP apps know us by (BETTER_AUTH_URL + /mcp). Tokens
      // must be made for it, and it is where apps learn how to sign in.
      { resource: config.getOrThrow<string>('MCP_RESOURCE_URL') },
    );
  }

  async handle(
    request: ExpressRequest,
    response: ExpressResponse,
  ): Promise<void> {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(key, value);
    }
    const answer = await this.protectedHandler(
      new Request(
        new URL(request.originalUrl, `http://${request.headers.host}`),
        {
          method: request.method,
          headers,
          body: request.method === 'POST' ? JSON.stringify(request.body) : null,
        },
      ),
    );
    response.status(answer.status);
    answer.headers.forEach((value, key) => response.setHeader(key, value));
    if (!answer.body) {
      response.end();
      return;
    }
    Readable.fromWeb(answer.body as NodeReadableStream).pipe(response);
  }

  // The tools, all acting as one user. No admin tools on purpose.
  private serverFor(userId: string): McpServer {
    const owner = { user: { id: userId } };
    const auth = owner as AuthSession;
    const server = new McpServer({ name: 'agentic', version: '1.0.0' });
    const readOnly = { readOnlyHint: true };

    const tool = <Shape extends z.ZodRawShape>(
      name: string,
      description: string,
      inputSchema: Shape,
      annotations: Record<string, boolean>,
      run: (input: z.infer<z.ZodObject<Shape>>) => Promise<unknown>,
    ) =>
      server.registerTool(
        name,
        { description, inputSchema, annotations },
        (async (input: z.infer<z.ZodObject<Shape>>): Promise<ToolResult> => {
          try {
            const result = await run(input);
            return {
              content: [
                { type: 'text', text: JSON.stringify(result ?? { ok: true }) },
              ],
            };
          } catch (error) {
            // Our own messages (not found, bad schedule) help the app; the
            // rest stay private.
            const status = (error as { status?: number }).status;
            const known = typeof status === 'number' && status < 500;
            if (!known) this.logger.error(`MCP tool ${name} failed.`);
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: known
                    ? (error as Error).message
                    : 'Something went wrong.',
                },
              ],
            };
          }
        }) as never,
      );

    tool('get_profile', "The signed-in user's profile.", {}, readOnly, () =>
      this.prisma.db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, email: true, image: true },
      }),
    );

    tool(
      'list_organizations',
      'Organizations the user belongs to, with their role.',
      {},
      readOnly,
      async () => {
        const members = await this.prisma.db.member.findMany({
          where: { userId },
          include: { organization: true },
          take: 100,
        });
        return members.map((member) => ({
          id: member.organization.id,
          name: member.organization.name,
          slug: member.organization.slug,
          role: member.role,
        }));
      },
    );

    tool(
      'list_routines',
      "The user's routines (scheduled agent tasks), newest first.",
      page,
      readOnly,
      (input) => this.routines.list(owner, input),
    );

    tool(
      'create_routine',
      'Create a routine: a prompt the agent runs on a schedule. cron has 5 ' +
        'fields (minute hour day month weekday), at most every 15 minutes.',
      {
        name: z.string().min(1).max(100),
        prompt: z.string().min(1).max(4000),
        cron: z.string().max(100).describe('For example "0 8 * * *"'),
        timezone: z.string().max(100).describe('IANA name, like Africa/Lagos'),
        enabled: z.boolean().optional(),
      },
      {},
      (input) => this.routines.create(owner, input),
    );

    tool(
      'update_routine',
      'Change a routine: name, prompt, schedule, or pause/resume (enabled).',
      {
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        prompt: z.string().min(1).max(4000).optional(),
        cron: z.string().max(100).optional(),
        timezone: z.string().max(100).optional(),
        enabled: z.boolean().optional(),
      },
      { idempotentHint: true },
      ({ id, ...changes }) => this.routines.update(id, owner, changes),
    );

    tool(
      'delete_routine',
      'Delete a routine and stop its schedule.',
      { id: z.string() },
      { destructiveHint: true },
      ({ id }) => this.routines.remove(id, owner),
    );

    tool(
      'run_routine',
      'Run a routine once now. The answer appears as a chat.',
      { id: z.string() },
      {},
      ({ id }) => this.routines.runNow(id, owner),
    );

    tool(
      'list_routine_runs',
      'Past runs of a routine. Each run is a chat; read it with get_chat_messages.',
      { id: z.string(), ...page },
      readOnly,
      ({ id, ...query }) => this.routines.runs(id, owner, query),
    );

    tool(
      'list_chats',
      "The user's chats with the agent, newest first.",
      page,
      readOnly,
      (input) => this.chats.list(auth, input),
    );

    tool(
      'get_chat_messages',
      'Saved messages of one of the user\'s chats. Page back with "before".',
      { chatId: z.string(), ...page },
      readOnly,
      async ({ chatId, ...query }) => {
        // Only the user's own chats, never the staff view.
        const chat = await this.prisma.db.chatSession.findFirst({
          where: { id: chatId, userId },
          select: { id: true },
        });
        if (!chat) {
          throw Object.assign(new Error('Chat not found.'), { status: 404 });
        }
        return this.chats.messages(chatId, auth, {}, query);
      },
    );

    return server;
  }
}
