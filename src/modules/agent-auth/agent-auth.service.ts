import { Injectable, UnauthorizedException } from '@nestjs/common';
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

// AI agents: discovery, capabilities, and who an agent is acting for.
// Registering agents, requesting and approving capabilities, and running them
// go through Better Auth's Agent Auth routes under /api/auth.
@Injectable()
export class AgentAuthService {
  constructor(
    private readonly betterAuth: BetterAuthService,
    private readonly config: ConfigService,
  ) {}

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
