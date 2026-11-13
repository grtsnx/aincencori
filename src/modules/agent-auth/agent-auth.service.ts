import {
  BadRequestException,
  Injectable,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type AgentSession, verifyAgentRequest } from '@better-auth/agent-auth';
import type { IncomingHttpHeaders } from 'node:http';
import { agentCapabilities } from '@/config/auth/agent.js';
import { authBasePath } from '@/config/auth/better-auth.js';
import type {
  AgentCapabilityDto,
  AgentConfigurationDto,
  AgentSessionDto,
} from '@/dto';
import { BetterAuthService } from '@/lib/better-auth/better-auth.service.js';
import { BotService } from '../bot/bot.service.js';
import { ChatService } from '../chat/chat.service.js';
import { DocumentService } from '../document/document.service.js';
import { PlanService } from '../plan/plan.service.js';
import { UsageService } from '../usage/usage.service.js';

// A text argument an agent sent, checked.
function text(
  args: Record<string, unknown>,
  name: string,
  max: number,
  required = true,
): string | undefined {
  const value = args[name];
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequestException(`${name} is required.`);
    return undefined;
  }
  if (typeof value !== 'string' || value.length > max) {
    throw new BadRequestException(`${name} must be text, at most ${max} long.`);
  }
  return value;
}

// AI agents: discovery, capabilities, and who an agent is acting for.
// Registering agents, requesting and approving capabilities, and running them
// go through Better Auth's Agent Auth routes under /v1/auth.
@Injectable()
export class AgentAuthService implements OnModuleInit {
  constructor(
    private readonly betterAuth: BetterAuthService,
    private readonly config: ConfigService,
    private readonly chats: ChatService,
    private readonly bots: BotService,
    private readonly documents: DocumentService,
    private readonly plans: PlanService,
    private readonly usage: UsageService,
  ) {}

  onModuleInit(): void {
    this.betterAuth.useAgentCapabilities((capability, userId, args) =>
      this.run(capability, userId, args),
    );
  }

  // Runs a capability the user granted, as that user: the same checks and
  // limits as their own requests (allowance, rules for risky steps).
  private async run(
    capability: string,
    userId: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const owner = { user: { id: userId } } as never;
    switch (capability) {
      case 'list_bots': {
        const bots = await this.bots.list(owner, { limit: 100 });
        return bots.map(({ id, name, description, enabled }) => ({
          id,
          name,
          description,
          enabled,
        }));
      }
      case 'ask':
        return this.chats.ask(userId, {
          message: text(args, 'message', 8000) as string,
          botId: text(args, 'botId', 200, false),
          chatId: text(args, 'chatId', 200, false),
        });
      case 'search_documents':
        return this.documents.search(owner, {
          q: text(args, 'query', 500) as string,
        });
      case 'start_plan':
        return this.plans.create(owner, {
          goal: text(args, 'goal', 4000) as string,
          botId: text(args, 'botId', 200, false),
        });
      case 'get_usage':
        return this.usage.mine(owner);
      default:
        throw new BadRequestException(`Unknown capability: ${capability}`);
    }
  }

  // The discovery document agents read first.
  async configuration(): Promise<AgentConfigurationDto> {
    const response = await this.betterAuth.auth.handler(
      new Request(`${this.baseUrl()}${authBasePath}/agent-configuration`),
    );
    return (await response.json()) as AgentConfigurationDto;
  }

  capabilities(): AgentCapabilityDto[] {
    return agentCapabilities.map(({ name, description }) => ({
      name,
      description,
    }));
  }

  // The agent behind a signed agent token, and the user it acts for.
  async session(
    headers: IncomingHttpHeaders,
    url: string,
  ): Promise<AgentSessionDto> {
    const request = new Request(`${this.baseUrl()}${url}`, {
      headers: Object.entries(headers).flatMap(([name, value]) =>
        value === undefined
          ? []
          : [[name, Array.isArray(value) ? value.join(', ') : value]],
      ) as [string, string][],
    });
    const session = (await verifyAgentRequest(
      request,
      this.betterAuth.auth,
    )) as AgentSession | null;
    if (!session) {
      throw new UnauthorizedException('Send a valid agent token.');
    }

    return {
      agent: {
        id: session.agent.id,
        name: session.agent.name,
        mode: session.agent.mode,
        capabilities: session.agent.capabilityGrants
          .filter((grant) => grant.status === 'active')
          .map((grant) => grant.capability),
      },
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
    };
  }

  private baseUrl(): string {
    return this.config.getOrThrow<string>('BETTER_AUTH_URL');
  }
}
