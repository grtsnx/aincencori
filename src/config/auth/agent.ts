import {
  agentAuth,
  type AgentSession,
  type Capability,
} from '@better-auth/agent-auth';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError } from 'better-auth/api';

// What AI agents may do for a user, once that user approves each one.
// get_profile is answered here; the rest run in the app (see
// modules/agent-auth), through the same checks as the user's own requests:
// their allowance, and their rules for risky steps.
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
  {
    name: 'list_bots',
    description: "List the user's bots: id, name and what each does.",
  },
  {
    name: 'ask',
    description:
      "Send a message to the user's assistant or one of their bots, and " +
      'get the answer. Saved in their chats. Risky steps wait for the user.',
    input: {
      type: 'object',
      properties: {
        message: { type: 'string', maxLength: 8000 },
        botId: { type: 'string', description: 'Empty: the assistant' },
        chatId: { type: 'string', description: 'Continue this chat' },
      },
      required: ['message'],
    },
  },
  {
    name: 'search_documents',
    description: "Search the user's documents (their knowledge).",
    input: {
      type: 'object',
      properties: { query: { type: 'string', maxLength: 500 } },
      required: ['query'],
    },
  },
  {
    name: 'start_plan',
    description:
      'Start a plan: a big goal worked through in steps in the background.',
    input: {
      type: 'object',
      properties: {
        goal: { type: 'string', maxLength: 4000 },
        botId: { type: 'string' },
      },
      required: ['goal'],
    },
  },
  {
    name: 'get_usage',
    description: "The user's plan and this month's AI spend.",
  },
];

// Runs the capabilities the app handles. Set by modules/agent-auth.
export type AgentCapabilityRunner = (
  capability: string,
  userId: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

// Runs an approved capability. Better Auth has already checked the agent's
// signed token and that the user granted this capability.
export async function executeAgentCapability(
  capability: string,
  agentSession: AgentSession,
  args: Record<string, unknown> = {},
  runner?: AgentCapabilityRunner,
): Promise<unknown> {
  if (capability === 'get_profile') {
    return {
      id: agentSession.user.id,
      name: agentSession.user.name,
      email: agentSession.user.email,
    };
  }
  if (
    runner &&
    agentCapabilities.some((candidate) => candidate.name === capability)
  ) {
    return runner(capability, agentSession.user.id, args);
  }
  throw new APIError('NOT_FOUND', {
    message: `Unknown capability: ${capability}`,
  });
}

// One Agent Auth event, for the activity log.
export interface AgentAuthActivity {
  userId: string | null;
  actor: string;
  action: string;
  target: string | null;
}

interface AgentAuthSettings {
  appName: string;
  appURL: string;
  trustProxy: boolean;
  // True when Redis is there: caches are then shared by every API server.
  sharedCache: boolean;
  runCapability?: AgentCapabilityRunner;
  onActivity?: (entry: AgentAuthActivity) => void;
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
    onExecute: ({ capability, agentSession, arguments: args }) =>
      executeAgentCapability(
        capability,
        agentSession,
        args,
        settings.runCapability,
      ),
    // Agents being added, approved, revoked, and each capability they run.
    onEvent: (event) => {
      const executed = event.type === 'capability.executed';
      settings.onActivity?.({
        userId:
          (executed ? event.userId : undefined) ??
          (event.actorType === 'user' ? (event.actorId ?? null) : null),
        actor:
          event.actorType === 'user'
            ? 'user'
            : `agent:${(executed && event.agentName) || event.agentId || 'unknown'}`,
        action: `agent-auth.${event.type}`,
        target: executed ? event.capability : (event.targetId ?? null),
      });
    },
  }) as BetterAuthPlugin;
}
