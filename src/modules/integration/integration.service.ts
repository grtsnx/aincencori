import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import type { MCPServer } from 'cencori/agents';
import { randomUUID } from 'node:crypto';
import { userMcpServer } from '@/config/agents/agents.js';
import { maxIntegrationsPerUser } from '@/config/agents/limits.js';
import type {
  CreateIntegrationDto,
  IntegrationDto,
  IntegrationToolDto,
  ListIntegrationsQueryDto,
  UpdateIntegrationDto,
} from '@/dto';
import type { Integration } from '@/generated/prisma/client.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import {
  assertPublicUrl,
  safeFetch,
  UnsafeUrlError,
} from '@/middleware/commons/index.js';
import { ChatService } from '../chat/chat.service.js';

interface Owner {
  user: { id: string };
}

// Integrations: MCP servers a user connects so the chat agent can use their
// tools (GitHub, Notion, their own...). A user can have many. Tokens are
// stored encrypted and never sent back. Every tool call asks the user first.
@Injectable()
export class IntegrationService implements OnModuleInit {
  // Only local development may use http and localhost addresses.
  private readonly allowPrivate: boolean;
  private readonly fetch: typeof fetch;
  // Connected servers, kept while the integration is unchanged, so a chat
  // turn does not ask each server for its tool list again.
  private readonly servers = new Map<string, MCPServer>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
  ) {
    this.allowPrivate = config.get<string>('NODE_ENV') !== 'production';
    this.fetch = safeFetch(this.allowPrivate);
  }

  onModuleInit(): void {
    // The chat agent gets each user's enabled servers.
    this.chat.useIntegrations((userId) => this.serversFor(userId));
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
    return integrations.map(toDto);
  }

  async create(
    auth: Owner,
    body: CreateIntegrationDto,
  ): Promise<IntegrationDto> {
    await this.checkUrl(body.url);
    const count = await this.prisma.db.integration.count({
      where: { userId: auth.user.id },
    });
    if (count >= maxIntegrationsPerUser) {
      throw new BadRequestException(
        `You can connect up to ${maxIntegrationsPerUser} integrations.`,
      );
    }
    try {
      const integration = await this.prisma.db.integration.create({
        data: {
          id: randomUUID(),
          userId: auth.user.id,
          name: body.name,
          url: body.url,
          token: body.token ? await this.encrypt(body.token) : null,
          enabled: body.enabled ?? true,
        },
      });
      return toDto(integration);
    } catch (error) {
      throw nameTaken(error) ?? error;
    }
  }

  async update(
    id: string,
    auth: Owner,
    body: UpdateIntegrationDto,
  ): Promise<IntegrationDto> {
    await this.own(id, auth);
    if (body.url !== undefined) await this.checkUrl(body.url);
    const { token, ...rest } = body;
    try {
      const integration = await this.prisma.db.integration.update({
        where: { id },
        data: {
          ...rest,
          // An empty string removes the token; leaving it out keeps it.
          ...(token !== undefined && {
            token: token ? await this.encrypt(token) : null,
          }),
        },
      });
      return toDto(integration);
    } catch (error) {
      throw nameTaken(error) ?? error;
    }
  }

  async remove(id: string, auth: Owner): Promise<void> {
    await this.own(id, auth);
    await this.prisma.db.integration.delete({ where: { id } });
  }

  // Connects to the server now and lists its tools: a quick way to check an
  // integration works.
  async tools(id: string, auth: Owner): Promise<IntegrationToolDto[]> {
    const integration = await this.own(id, auth);
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

  // The user's enabled servers, ready for the agent.
  private async serversFor(userId: string): Promise<MCPServer[]> {
    const integrations = await this.prisma.db.integration.findMany({
      where: { userId, enabled: true },
      orderBy: { createdAt: 'asc' },
      take: maxIntegrationsPerUser,
    });
    return Promise.all(
      integrations.map(async (integration) => {
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

  private async server(
    integration: Integration,
    quiet: boolean,
  ): Promise<MCPServer> {
    return userMcpServer({
      name: integration.name,
      url: integration.url,
      token: integration.token
        ? await symmetricDecrypt({ key: this.secret, data: integration.token })
        : undefined,
      fetch: this.fetch,
      quiet,
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

function nameTaken(error: unknown): ConflictException | undefined {
  return (error as { code?: string }).code === 'P2002'
    ? new ConflictException('You already have an integration with this name.')
    : undefined;
}

function toDto(integration: Integration): IntegrationDto {
  return {
    id: integration.id,
    name: integration.name,
    url: integration.url,
    hasToken: integration.token !== null,
    enabled: integration.enabled,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };
}
