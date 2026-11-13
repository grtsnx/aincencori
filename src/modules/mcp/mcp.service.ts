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
import { listingCategories } from '@/config/agents/limits.js';
import {
  type AuthSession,
  BetterAuthService,
} from '@/lib/better-auth/better-auth.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { BotService } from '../bot/bot.service.js';
import { ChatService } from '../chat/chat.service.js';
import { DocumentService } from '../document/document.service.js';
import { GroupService } from '../group/group.service.js';
import { IntegrationService } from '../integration/integration.service.js';
import { MarketplaceService } from '../marketplace/marketplace.service.js';
import { PlanService } from '../plan/plan.service.js';
import { RoutineService } from '../routine/routine.service.js';
import { ApprovalService } from '../approval/approval.service.js';
import { UsageService } from '../usage/usage.service.js';

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
// signed-in user's own services through it: profile, organizations, chats
// (including sending a message), bots with their memories and skills,
// groups, routines, integrations, documents (knowledge), plans and the
// marketplace. Admin and staff features are never offered here.
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
    private readonly bots: BotService,
    private readonly groups: GroupService,
    private readonly integrations: IntegrationService,
    private readonly documents: DocumentService,
    private readonly plans: PlanService,
    private readonly marketplace: MarketplaceService,
    private readonly usage: UsageService,
    private readonly approvals: ApprovalService,
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
        botId: z
          .string()
          .optional()
          .describe(
            'The bot that runs it; leave out for the default assistant',
          ),
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

    tool(
      'send_message',
      'Send a message and get the answer. Without botId or groupId the ' +
        'default assistant answers. Pass chatId to continue a chat.',
      {
        message: z.string().min(1).max(32_000),
        chatId: z.string().optional(),
        botId: z.string().optional(),
        groupId: z.string().optional(),
      },
      {},
      (input) => this.chats.ask(userId, input),
    );

    tool(
      'delete_chat',
      "Delete one of the user's chats, its history and its files.",
      { chatId: z.string() },
      { destructiveHint: true },
      ({ chatId }) => this.chats.remove(chatId, auth),
    );

    // ── Bots ───────────────────────────────────────────────────────────

    tool(
      'list_bots',
      "The user's bots, newest first.",
      page,
      readOnly,
      (input) => this.bots.list(owner, input),
    );

    tool(
      'get_bot',
      'One bot with its integrations.',
      { id: z.string() },
      readOnly,
      ({ id }) => this.bots.get(id, owner),
    );

    tool(
      'create_bot',
      'Create a bot. Only name and instructions are needed.',
      {
        name: z.string().min(1).max(60),
        instructions: z.string().min(1).max(8000),
        description: z.string().max(300).optional(),
        integrationIds: z.array(z.string()).max(10).optional(),
        documentIds: z
          .array(z.string())
          .max(50)
          .optional()
          .describe('Documents the bot may search'),
      },
      {},
      (input) => this.bots.create(owner, input),
    );

    tool(
      'update_bot',
      'Change a bot: name, description, instructions, integrations, documents, or on/off.',
      {
        id: z.string(),
        name: z.string().min(1).max(60).optional(),
        description: z.string().max(300).optional(),
        instructions: z.string().min(1).max(8000).optional(),
        integrationIds: z.array(z.string()).max(10).optional(),
        documentIds: z.array(z.string()).max(50).optional(),
        enabled: z.boolean().optional(),
      },
      { idempotentHint: true },
      ({ id, ...changes }) => this.bots.update(id, owner, changes),
    );

    tool(
      'delete_bot',
      'Delete a bot with its memories, skills and routines.',
      { id: z.string() },
      { destructiveHint: true },
      ({ id }) => this.bots.remove(id, owner),
    );

    tool(
      'list_bot_memories',
      'Facts a bot knows, newest first.',
      { botId: z.string(), ...page },
      readOnly,
      ({ botId, ...query }) => this.bots.memories(botId, owner, query),
    );

    tool(
      'add_bot_memory',
      'Teach a bot a fact it uses in every chat.',
      { botId: z.string(), text: z.string().min(1).max(500) },
      {},
      ({ botId, text }) => this.bots.addMemory(botId, owner, { text }),
    );

    tool(
      'delete_bot_memory',
      'Make a bot forget one fact.',
      { botId: z.string(), memoryId: z.string() },
      { destructiveHint: true },
      ({ botId, memoryId }) => this.bots.removeMemory(botId, memoryId, owner),
    );

    tool(
      'list_bot_skills',
      'Playbooks a bot can follow.',
      { botId: z.string() },
      readOnly,
      ({ botId }) => this.bots.skills(botId, owner),
    );

    tool(
      'add_bot_skill',
      'Give a bot a playbook: when to use it, and the steps.',
      {
        botId: z.string(),
        name: z.string().min(1).max(60),
        description: z.string().min(1).max(300),
        instructions: z.string().min(1).max(20_000),
      },
      {},
      ({ botId, ...skill }) => this.bots.addSkill(botId, owner, skill),
    );

    tool(
      'update_bot_skill',
      'Change a playbook. Each change is a new version.',
      {
        botId: z.string(),
        skillId: z.string(),
        name: z.string().min(1).max(60).optional(),
        description: z.string().min(1).max(300).optional(),
        instructions: z.string().min(1).max(20_000).optional(),
      },
      { idempotentHint: true },
      ({ botId, skillId, ...changes }) =>
        this.bots.updateSkill(botId, skillId, owner, changes),
    );

    tool(
      'delete_bot_skill',
      'Remove a playbook from a bot.',
      { botId: z.string(), skillId: z.string() },
      { destructiveHint: true },
      ({ botId, skillId }) => this.bots.removeSkill(botId, skillId, owner),
    );

    // ── Groups ─────────────────────────────────────────────────────────

    tool('list_groups', "The user's teams of bots.", page, readOnly, (input) =>
      this.groups.list(owner, input),
    );

    tool(
      'create_group',
      "Put 2 to 6 of the user's bots on one team.",
      {
        name: z.string().min(1).max(60),
        botIds: z.array(z.string()).min(2).max(6),
        description: z.string().max(300).optional(),
        instructions: z.string().max(4000).optional(),
      },
      {},
      (input) => this.groups.create(owner, input),
    );

    tool(
      'update_group',
      'Change a team: name, bots, or how they work together.',
      {
        id: z.string(),
        name: z.string().min(1).max(60).optional(),
        botIds: z.array(z.string()).min(2).max(6).optional(),
        description: z.string().max(300).optional(),
        instructions: z.string().max(4000).optional(),
      },
      { idempotentHint: true },
      ({ id, ...changes }) => this.groups.update(id, owner, changes),
    );

    tool(
      'delete_group',
      'Delete a team. Its bots are kept.',
      { id: z.string() },
      { destructiveHint: true },
      ({ id }) => this.groups.remove(id, owner),
    );

    // ── Integrations ───────────────────────────────────────────────────

    tool(
      'list_integration_apps',
      'Apps the user can connect, like Gmail and Slack.',
      {},
      readOnly,
      () => this.integrations.apps(),
    );

    tool(
      'list_integrations',
      'What the user connected, and whether each is ready.',
      page,
      readOnly,
      (input) => this.integrations.list(owner, input),
    );

    tool(
      'create_integration',
      'Add an app (then the user signs in with connect_integration) or ' +
        'the user\'s own MCP server (app "mcp", with url).',
      {
        name: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/)
          .max(40)
          .describe('A label like work-gmail'),
        app: z.string().max(60).optional(),
        url: z.string().max(2000).optional(),
        token: z.string().max(4000).optional(),
      },
      {},
      (input) => this.integrations.create(owner, input),
    );

    tool(
      'connect_integration',
      'Get the link where the user signs in to a connected app. Show it to the user.',
      { id: z.string() },
      {},
      ({ id }) => this.integrations.connect(id, owner),
    );

    tool(
      'update_integration',
      'Rename an integration, or turn it on or off.',
      {
        id: z.string(),
        name: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/)
          .max(40)
          .optional(),
        enabled: z.boolean().optional(),
      },
      { idempotentHint: true },
      ({ id, ...changes }) => this.integrations.update(id, owner, changes),
    );

    tool(
      'delete_integration',
      'Disconnect an app and remove it from every bot.',
      { id: z.string() },
      { destructiveHint: true },
      ({ id }) => this.integrations.remove(id, owner),
    );

    // ── Knowledge (documents) ──────────────────────────────────────────

    tool(
      'list_documents',
      "Files in the user's knowledge, and whether each is ready.",
      page,
      readOnly,
      (input) => this.documents.list(owner, input),
    );

    tool(
      'add_document',
      "Add text to the user's knowledge, as a document bots can search.",
      {
        name: z.string().min(1).max(200),
        text: z.string().min(1).max(1_000_000),
      },
      {},
      (input) => this.documents.create(owner, input),
    );

    tool(
      'search_documents',
      "Search the user's documents with key words. botId: only that bot's.",
      { q: z.string().min(1).max(500), botId: z.string().optional() },
      readOnly,
      (input) => this.documents.search(owner, input),
    );

    tool(
      'delete_document',
      'Delete a document. Bots stop using it.',
      { id: z.string() },
      { destructiveHint: true },
      ({ id }) => this.documents.remove(id, owner),
    );

    // ── Plans ──────────────────────────────────────────────────────────

    tool(
      'start_plan',
      'Start a plan: a big goal split into steps and worked through in ' +
        'the background. Check it with get_plan.',
      {
        goal: z.string().min(1).max(4000),
        botId: z.string().optional().describe('Empty: the default assistant'),
      },
      {},
      (input) => this.plans.create(owner, input),
    );

    tool(
      'list_plans',
      "The user's plans, with steps.",
      page,
      readOnly,
      (input) => this.plans.list(owner, input),
    );

    tool(
      'get_plan',
      'A plan with each step and its result.',
      { id: z.string() },
      readOnly,
      ({ id }) => this.plans.get(id, owner),
    );

    tool(
      'stop_plan',
      'Stop a plan after the step running now.',
      { id: z.string() },
      {},
      ({ id }) => this.plans.stop(id, owner),
    );

    tool(
      'resume_plan',
      'Carry on a paused, stopped or failed plan.',
      { id: z.string() },
      {},
      ({ id }) => this.plans.resume(id, owner),
    );

    tool(
      'delete_plan',
      'Delete a plan. Its chat is kept.',
      { id: z.string() },
      { destructiveHint: true },
      ({ id }) => this.plans.remove(id, owner),
    );

    // ── Marketplace ────────────────────────────────────────────────────

    tool(
      'browse_marketplace',
      'Bots other people shared. Copy one with copy_marketplace_bot.',
      {
        q: z.string().max(100).optional(),
        category: z.string().max(40).optional(),
        sort: z.enum(['popular', 'newest']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).max(1000).optional(),
      },
      readOnly,
      (input) => this.marketplace.browse(input),
    );

    tool(
      'get_marketplace_bot',
      'What a shared bot does: instructions and skills.',
      { id: z.string() },
      readOnly,
      ({ id }) => this.marketplace.get(id, auth),
    );

    tool(
      'copy_marketplace_bot',
      "Add a copy of a shared bot to the user's bots.",
      { id: z.string() },
      {},
      ({ id }) => this.marketplace.import(id, owner),
    );

    tool(
      'list_my_shared_bots',
      'Bots the user shared, with their review status.',
      {},
      readOnly,
      () => this.marketplace.mine(owner),
    );

    tool(
      'share_bot',
      'Share a copy of a bot on the marketplace (after a safety review). ' +
        'The bot needs a description. Never shares memories or sign-ins.',
      {
        botId: z.string(),
        category: z.enum(listingCategories),
        authorName: z.string().min(1).max(60).optional(),
      },
      {},
      (input) => this.marketplace.publish(owner, input),
    );

    tool(
      'unshare_bot',
      'Take a shared bot off the marketplace. Copies stay.',
      { id: z.string().describe('The shared bot id (not the bot id)') },
      { destructiveHint: true },
      ({ id }) => this.marketplace.unpublish(id, owner),
    );

    // ── Usage and approvals ────────────────────────────────────────────

    tool(
      'get_usage',
      "The user's plan, this month's AI spend and what is left.",
      {},
      readOnly,
      () => this.usage.mine(owner),
    );

    tool(
      'list_approvals',
      'Steps the AI stopped at, waiting for the user. The user approves ' +
        'them in the app; they cannot be approved from here.',
      {},
      readOnly,
      () => this.approvals.inbox(owner),
    );

    return server;
  }
}
