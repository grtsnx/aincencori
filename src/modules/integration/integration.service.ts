import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import type { MCPServer } from 'cencori/agents';
import { randomUUID } from 'node:crypto';
import { userMcpServer } from '@/config/agents/agents.js';
import { deleteWorkspaceJob } from '@/config/agents/jobs.js';
import { maxIntegrationsPerUser } from '@/config/agents/limits.js';
import type {
  CreateIntegrationDto,
  InstallMcpServerDto,
  IntegrationAppDto,
  IntegrationConnectDto,
  IntegrationDto,
  IntegrationToolDto,
  ListIntegrationsQueryDto,
  McpCatalogPageDto,
  McpCatalogQueryDto,
  McpCatalogServerDto,
  UpdateIntegrationDto,
} from '@/dto';
import type { Integration } from '@/generated/prisma/client.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { CencoriService } from '@/lib/cencori/cencori.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { assertPublicUrl, safeFetch, UnsafeUrlError } from '@/middleware';
import { ApprovalService } from '../approval/approval.service.js';

interface Owner {
  user: { id: string };
}

// The public MCP registry (registry.modelcontextprotocol.io). Fixed, so not a
// setting.
const registryUrl = 'https://registry.modelcontextprotocol.io/v0';
const registryCacheMs = 5 * 60_000;

interface RegistryEntry {
  server?: {
    name?: string;
    title?: string | null;
    description?: string;
    version?: string;
    websiteUrl?: string | null;
    remotes?: {
      type?: string;
      url?: string;
      headers?: {
        name?: string;
        value?: string;
        description?: string;
        isRequired?: boolean;
        isSecret?: boolean;
      }[];
    }[];
  };
}

// A registry server we can connect to: an online (streamable HTTP) address
// with nothing to fill in, needing at most a Bearer token. Others: null.
export function catalogServer(
  entry: RegistryEntry,
): McpCatalogServerDto | null {
  const server = entry.server;
  if (!server?.name) return null;
  for (const remote of server.remotes ?? []) {
    if (remote.type !== 'streamable-http' || !remote.url) continue;
    if (!remote.url.startsWith('https://') || remote.url.includes('{'))
      continue;
    const headers = remote.headers ?? [];
    const bearer = headers.find(
      (header) =>
        header.name?.toLowerCase() === 'authorization' &&
        (header.value ?? 'Bearer ').startsWith('Bearer '),
    );
    // Any other header to fill in is one we cannot send.
    const others = headers.filter(
      (header) => header !== bearer && header.isRequired,
    );
    if (others.length > 0) continue;
    return {
      server: server.name,
      title: server.title || server.name.split('/').pop() || server.name,
      description: server.description ?? '',
      version: server.version ?? '',
      url: remote.url,
      needsToken: Boolean(bearer),
      tokenHint: bearer?.description ?? null,
      website: server.websiteUrl ?? null,
    };
  }
  return null;
}

// What Cencori tells us about an app and a connection (the parts we use).
interface Connector {
  slug: string;
  name: string;
  auth_type: string;
  status: string;
}
interface Connection {
  id: string;
  status: string;
}

// Our own kind: an MCP server the user runs, called by us directly.
const ownMcp: IntegrationAppDto = {
  slug: 'mcp',
  name: 'Your own MCP server',
  signIn: 'none',
};

// Integrations: things a user connects so their bots can use the tools.
// - Apps (Gmail, Slack, Notion...): the user signs in through Cencori, which
//   keeps the sign-in. One user can connect the same app many times (two
//   Gmail accounts), each with its own label.
// - Their own MCP server: an address and optional token, kept by us.
// A bot only gets the integrations its owner picked for it (see modules/bot).
@Injectable()
export class IntegrationService implements OnModuleInit, OnModuleDestroy {
  // Tests swap in a stand-in for the MCP registry.
  registryFetch: typeof fetch = (input, init) => fetch(input, init);
  private readonly catalogCache = new Map<
    string,
    { at: number; page: McpCatalogPageDto }
  >();

  private readonly logger = new Logger(IntegrationService.name);
  // Only local development may use http and localhost addresses.
  private readonly allowPrivate: boolean;
  private readonly fetch: ReturnType<typeof safeFetch>;
  // Connected MCP servers, kept while the integration is unchanged, so a
  // chat turn does not ask each server for its tool list again.
  private readonly servers = new Map<string, MCPServer>();
  private appsCache?: { at: number; apps: IntegrationAppDto[] };

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cencori: CencoriService,
    private readonly bullmq: BullmqService,
    private readonly approvals: ApprovalService,
  ) {
    this.allowPrivate = config.get<string>('NODE_ENV') !== 'production';
    this.fetch = safeFetch(this.allowPrivate);
  }

  onModuleInit(): void {
    this.bullmq.handle<{ tenantId: string }>(
      deleteWorkspaceJob,
      async ({ tenantId }) => {
        if (!this.cencori.isConfigured) return;
        await this.cencori.tenantsRemove(tenantId);
      },
    );
  }

  onModuleDestroy(): Promise<void> {
    return this.fetch.close();
  }

  // Apps a user can connect: Cencori's, plus their own MCP server.
  async apps(): Promise<IntegrationAppDto[]> {
    if (this.appsCache && Date.now() - this.appsCache.at < 5 * 60_000) {
      return this.appsCache.apps;
    }
    let apps = [ownMcp];
    if (this.cencori.isConfigured) {
      const { data } = await this.cencori.connectionsListConnectors();
      apps = [
        ...(data as Connector[])
          // The "generic" ones are building blocks, not apps a user picks.
          .filter(
            (connector) =>
              connector.status === 'active' &&
              connector.auth_type === 'oauth2' &&
              !connector.slug.startsWith('generic-'),
          )
          .map((connector) => ({
            slug: connector.slug,
            name: connector.name,
            signIn: 'oauth' as const,
          })),
        ownMcp,
      ];
      this.appsCache = { at: Date.now(), apps };
    }
    return apps;
  }

  async list(
    auth: Owner,
    query: ListIntegrationsQueryDto,
  ): Promise<IntegrationDto[]> {
    const integrations = await this.prisma.db.integration.findMany({
      where: { userId: auth.user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
    const statuses = await this.statuses(auth.user.id, integrations);
    return integrations.map((integration) => toDto(integration, statuses));
  }

  // The MCP catalog: servers from the public MCP registry that can be
  // added in a click. Pages are kept for 5 minutes.
  async catalog(query: McpCatalogQueryDto): Promise<McpCatalogPageDto> {
    const params = new URLSearchParams({ limit: '50', version: 'latest' });
    if (query.search) params.set('search', query.search);
    if (query.cursor) params.set('cursor', query.cursor);
    const key = params.toString();
    const cached = this.catalogCache.get(key);
    if (cached && cached.at > Date.now() - registryCacheMs) return cached.page;
    const data = (await this.fromRegistry(`/servers?${key}`)) as {
      servers?: RegistryEntry[];
      metadata?: { nextCursor?: string | null };
    };
    const page = {
      servers: (data.servers ?? [])
        .map(catalogServer)
        .filter((server): server is McpCatalogServerDto => server !== null),
      nextCursor: data.metadata?.nextCursor ?? null,
    };
    if (this.catalogCache.size > 500) this.catalogCache.clear();
    this.catalogCache.set(key, { at: Date.now(), page });
    return page;
  }

  // Adds a catalog server as the user's own MCP server. Its address comes
  // from the registry, never from the request; the usual checks apply.
  async install(
    auth: Owner,
    body: InstallMcpServerDto,
  ): Promise<IntegrationDto> {
    const entry = (await this.fromRegistry(
      `/servers/${encodeURIComponent(body.server)}/versions/latest`,
    ).catch(() => null)) as RegistryEntry | null;
    const server = entry ? catalogServer(entry) : null;
    if (!server) {
      throw new NotFoundException(
        'That server is not in the catalog, or cannot be added here.',
      );
    }
    if (server.needsToken && !body.token) {
      throw new BadRequestException(
        `This server needs a token: ${server.tokenHint ?? 'an access token'}.`,
      );
    }
    return this.create(auth, {
      name: body.name,
      app: ownMcp.slug,
      url: server.url,
      token: body.token,
    });
  }

  private async fromRegistry(path: string): Promise<unknown> {
    const response = await this.registryFetch(`${registryUrl}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404) throw new NotFoundException('Not found.');
    if (!response.ok) {
      throw new ServiceUnavailableException(
        'The MCP catalog is not answering. Try again soon.',
      );
    }
    return response.json();
  }

  async create(
    auth: Owner,
    body: CreateIntegrationDto,
  ): Promise<IntegrationDto> {
    const app = body.app ?? ownMcp.slug;
    const userId = auth.user.id;
    const count = await this.prisma.db.integration.count({ where: { userId } });
    if (count >= maxIntegrationsPerUser) {
      throw new BadRequestException(
        `You can connect up to ${maxIntegrationsPerUser} integrations.`,
      );
    }
    if (
      await this.prisma.db.integration.findFirst({
        where: { userId, name: body.name },
        select: { id: true },
      })
    ) {
      throw nameTaken();
    }

    let connectionId: string | null = null;
    if (app === ownMcp.slug) {
      if (!body.url) throw new BadRequestException('url is required.');
      await this.checkUrl(body.url);
    } else {
      if (body.url || body.token) {
        throw new BadRequestException(
          'url and token are only for your own MCP server.',
        );
      }
      if (!(await this.apps()).some((known) => known.slug === app)) {
        throw new BadRequestException('Unknown app. See "List apps".');
      }
      // The user signs in next, with "Connect".
      const connection = (await this.cencori.connectionsCreate({
        connector: app,
        owner_type: 'user',
        tenant_id: await this.tenantFor(userId),
        external_user_id: userId,
      })) as Connection;
      connectionId = connection.id;
    }

    try {
      const integration = await this.prisma.db.integration.create({
        data: {
          id: randomUUID(),
          userId,
          name: body.name,
          app,
          url: app === ownMcp.slug ? body.url : null,
          token: body.token ? await this.encrypt(body.token) : null,
          connectionId,
          enabled: body.enabled ?? true,
        },
      });
      return toDto(
        integration,
        new Map(connectionId ? [[connectionId, 'pending']] : []),
      );
    } catch (error) {
      if (connectionId) await this.dropConnection(connectionId);
      throw isUniqueError(error) ? nameTaken() : error;
    }
  }

  // Where to send the user to sign in to the app (Google, Slack...). They
  // come back to the frontend's /integrations page.
  async connect(id: string, auth: Owner): Promise<IntegrationConnectDto> {
    const integration = await this.own(id, auth);
    if (!integration.connectionId) {
      throw new BadRequestException('Your own MCP server needs no sign-in.');
    }
    const redirect = new URL(
      '/integrations',
      this.config.getOrThrow('APP_URL'),
    );
    redirect.searchParams.set('connected', integration.id);
    try {
      const { authorize_url } = await this.cencori.connectionsAuthorize(
        integration.connectionId,
        { redirect_uri: redirect.toString() },
      );
      return { authorizeUrl: authorize_url };
    } catch (error) {
      this.logger.warn(
        `Sign-in for ${integration.app} could not start: ${(error as Error).message}`,
      );
      throw new BadRequestException(
        `${integration.app} is not ready to connect yet. Its sign-in must be set up in Cencori first.`,
      );
    }
  }

  async update(
    id: string,
    auth: Owner,
    body: UpdateIntegrationDto,
  ): Promise<IntegrationDto> {
    const current = await this.own(id, auth);
    const { token, url, ...rest } = body;
    if ((url !== undefined || token !== undefined) && current.connectionId) {
      throw new BadRequestException(
        'url and token are only for your own MCP server.',
      );
    }
    if (url !== undefined) await this.checkUrl(url);
    try {
      const integration = await this.prisma.db.integration.update({
        where: { id },
        data: {
          ...rest,
          ...(url !== undefined && { url }),
          // An empty string removes the token; leaving it out keeps it.
          ...(token !== undefined && {
            token: token ? await this.encrypt(token) : null,
          }),
        },
      });
      return toDto(
        integration,
        await this.statuses(auth.user.id, [integration]),
      );
    } catch (error) {
      throw isUniqueError(error) ? nameTaken() : error;
    }
  }

  // Removes it from every bot too, and signs the app out at Cencori.
  async remove(id: string, auth: Owner): Promise<void> {
    const integration = await this.own(id, auth);
    await this.prisma.db.integration.delete({ where: { id } });
    if (integration.connectionId) {
      await this.dropConnection(integration.connectionId);
    }
  }

  // Connects to the user's MCP server now and lists its tools: a quick way
  // to check it works.
  async tools(id: string, auth: Owner): Promise<IntegrationToolDto[]> {
    const integration = await this.own(id, auth);
    if (!integration.url) {
      throw new BadRequestException(
        'Only your own MCP servers list their tools here.',
      );
    }
    const server = await this.server(integration, false);
    try {
      await server.connect();
      const tools = await server.listTools();
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
      }));
    } catch {
      throw new BadRequestException(
        'Could not reach this MCP server. Check the address and token.',
      );
    } finally {
      await server.close().catch(() => undefined);
    }
  }

  // ── For bots (modules/bot) ───────────────────────────────────────────

  // The ids among these that belong to the user.
  async owned(userId: string, ids: string[]): Promise<string[]> {
    const found = await this.prisma.db.integration.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true },
    });
    return found.map((integration) => integration.id);
  }

  // A bot's own-MCP integrations, ready for the agent.
  async mcpServers(integrations: Integration[]): Promise<MCPServer[]> {
    return Promise.all(
      integrations
        .filter((integration) => integration.enabled && integration.url)
        .map(async (integration) => {
          const key = `${integration.id}:${integration.updatedAt.getTime()}`;
          let server = this.servers.get(key);
          if (!server) {
            // Keeps memory bounded on a busy server.
            if (this.servers.size >= 1_000) this.servers.clear();
            server = await this.server(integration, true);
            this.servers.set(key, server);
          }
          return server;
        }),
    );
  }

  // A bot's app connections that are signed in, and the user's tenant.
  async activeConnections(
    userId: string,
    integrations: Integration[],
  ): Promise<{ tenantId: string; connectionIds: string[] } | undefined> {
    const apps = integrations.filter(
      (integration) => integration.enabled && integration.connectionId,
    );
    if (apps.length === 0) return undefined;
    const statuses = await this.statuses(userId, apps);
    const connectionIds = apps
      .map((integration) => integration.connectionId as string)
      .filter((connectionId) => statuses.get(connectionId) === 'active');
    if (connectionIds.length === 0) return undefined;
    return { tenantId: await this.tenantFor(userId), connectionIds };
  }

  // ── Internals ────────────────────────────────────────────────────────

  // The user's space at Cencori, made the first time it is needed.
  private async tenantFor(userId: string): Promise<string> {
    const db = this.prisma.db;
    const existing = await db.agentWorkspace.findUnique({ where: { userId } });
    if (existing) return existing.tenantId;
    const tenant = await this.cencori.tenantsCreate({
      external_id: userId,
      name: `User ${userId}`,
    });
    await this.cencori.tenantsUpsertUser(tenant.id, userId, {});
    try {
      await db.agentWorkspace.create({ data: { userId, tenantId: tenant.id } });
      return tenant.id;
    } catch (error) {
      // Two requests at once: keep the first, drop ours.
      if (!isUniqueError(error)) throw error;
      await this.cencori.tenantsRemove(tenant.id).catch(() => undefined);
      return (await db.agentWorkspace.findUniqueOrThrow({ where: { userId } }))
        .tenantId;
    }
  }

  // Connection id -> status at Cencori. One call for all of a user's apps.
  private async statuses(
    userId: string,
    integrations: Integration[],
  ): Promise<Map<string, string>> {
    const statuses = new Map<string, string>();
    if (!integrations.some((integration) => integration.connectionId)) {
      return statuses;
    }
    try {
      const workspace = await this.prisma.db.agentWorkspace.findUnique({
        where: { userId },
      });
      if (!workspace) return statuses;
      const { data } = await this.cencori.connectionsList(workspace.tenantId);
      for (const connection of data as Connection[]) {
        statuses.set(connection.id, connection.status);
      }
    } catch {
      // Cencori is away: statuses show as "unknown".
    }
    return statuses;
  }

  private async dropConnection(connectionId: string): Promise<void> {
    await this.cencori
      .connectionsRemove(connectionId)
      .catch(() =>
        this.logger.warn(`Connection ${connectionId} was not removed.`),
      );
  }

  private async server(
    integration: Integration,
    quiet: boolean,
  ): Promise<MCPServer> {
    return userMcpServer({
      name: integration.name,
      url: integration.url as string,
      token: integration.token
        ? await symmetricDecrypt({ key: this.secret, data: integration.token })
        : undefined,
      fetch: this.fetch,
      quiet,
      // Rules are read fresh before each chat turn.
      decide: (tool) => this.approvals.cachedDecision(integration.userId, tool),
    });
  }

  private async checkUrl(url: string): Promise<void> {
    try {
      await assertPublicUrl(url, this.allowPrivate);
    } catch (error) {
      if (error instanceof UnsafeUrlError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private encrypt(token: string): Promise<string> {
    return symmetricEncrypt({ key: this.secret, data: token });
  }

  private get secret(): string {
    return this.config.getOrThrow<string>('BETTER_AUTH_SECRET');
  }

  private async own(id: string, auth: Owner): Promise<Integration> {
    const integration = await this.prisma.db.integration.findUnique({
      where: { id },
    });
    if (!integration || integration.userId !== auth.user.id) {
      throw new NotFoundException('Integration not found.');
    }
    return integration;
  }
}

const isUniqueError = (error: unknown): boolean =>
  (error as { code?: string }).code === 'P2002';

const nameTaken = (): ConflictException =>
  new ConflictException('You already have an integration with this name.');

function toDto(
  integration: Integration,
  statuses: Map<string, string>,
): IntegrationDto {
  return {
    id: integration.id,
    name: integration.name,
    app: integration.app,
    // Our own MCP servers need no sign-in, so they are always ready.
    status: integration.connectionId
      ? (statuses.get(integration.connectionId) ?? 'unknown')
      : 'active',
    url: integration.url,
    hasToken: integration.token !== null,
    enabled: integration.enabled,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };
}
