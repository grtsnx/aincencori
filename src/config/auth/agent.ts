import type { AgentSession, Capability } from '@better-auth/agent-auth';
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
