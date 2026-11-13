import {
  agentAuth,
  type AgentSession,
  type Capability,
} from '@better-auth/agent-auth';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError } from 'better-auth/api';

// What AI agents may do for a user, once that user approves. Read-only for now:
// add a capability here, then handle it in executeAgentCapability.
export const agentCapabilities: Capability[] = [
  {
    name: 'get_profile',
    description: "Read the user's name and email.",
    output: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
      },
    },
  },
];

// Runs an approved capability. Better Auth has already checked the agent's
// signed token and that the user granted this capability.
export function executeAgentCapability(
  capability: string,
  agentSession: AgentSession,
): unknown {
  switch (capability) {
    case 'get_profile':
      return {
        id: agentSession.user.id,
        name: agentSession.user.name,
        email: agentSession.user.email,
      };
    default:
      throw new APIError('NOT_FOUND', {
        message: `Unknown capability: ${capability}`,
      });
  }
}

interface AgentAuthSettings {
  appName: string;
  appURL: string;
  trustProxy: boolean;
  // True when Redis is there: caches are then shared by every API server.
  sharedCache: boolean;
}

// The Agent Auth plugin: AI agents act for a user who approves each capability
// first. Typed as a plain plugin because its own types cannot be re-exported;
// its routes still work, and verifyAgentRequest() stays fully typed.
export function agentAuthPlugin(settings: AgentAuthSettings): BetterAuthPlugin {
  return agentAuth({
    providerName: settings.appName,
    providerDescription: `${settings.appName} API for AI agents`,
    modes: ['delegated'],
    deviceAuthorizationPage: `${settings.appURL}/device/capabilities`,
    trustProxy: settings.trustProxy,
    ...(settings.sharedCache && {
      jtiCacheStorage: 'secondary-storage' as const,
      jwksCacheStorage: 'secondary-storage' as const,
    }),
    capabilities: agentCapabilities,
    onExecute: ({ capability, agentSession }) =>
      executeAgentCapability(capability, agentSession),
  }) as BetterAuthPlugin;
}
