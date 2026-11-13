import {
  Agent,
  type FunctionTool,
  humanHandoff,
  type InputGuardrail,
  MCPServerStreamableHttp,
  type OutputGuardrail,
  tool,
  webFetch,
  webSearch,
} from 'cencori/agents';
import { z } from 'zod';

// What every tool gets for the signed-in user. ChatService fills it in.
export interface ChatContext {
  user: { id: string; name: string; email: string; image?: string | null };
  organizations: () => Promise<
    { id: string; name: string; slug: string; role: string }[]
  >;
  rename: (name: string) => Promise<void>;
  // The user's routines (scheduled agent tasks).
  routines: {
    list: () => Promise<RoutineSummary[]>;
    create: (input: RoutineInput) => Promise<RoutineSummary>;
    setEnabled: (id: string, enabled: boolean) => Promise<RoutineSummary>;
    remove: (id: string) => Promise<void>;
  };
}

export interface RoutineSummary {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
}

export interface RoutineInput {
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
}

// What the routine module gives the chat, per user id.
export interface RoutineActions {
  list: (userId: string) => Promise<RoutineSummary[]>;
  create: (userId: string, input: RoutineInput) => Promise<RoutineSummary>;
  setEnabled: (
    userId: string,
    id: string,
    enabled: boolean,
  ) => Promise<RoutineSummary>;
  remove: (userId: string, id: string) => Promise<void>;
}

export interface AgentSettings {
  // Never shown to anyone: the answer guardrail blocks replies that contain them.
  secrets: string[];
  // Optional: an MCP server whose tools the agent may use.
  mcpUrl?: string;
  // Tells our team when an agent hands a chat to a person.
  onHumanHandoff: (event: { sessionId: string; reason: string }) => void;
}

// ── Tools ────────────────────────────────────────────────────────────────

// Tools that return { widget } show UI in the chat (cards, lists...).
const myProfile = tool<z.ZodObject, ChatContext>({
  name: 'get_my_profile',
  description: "Show the signed-in user's profile.",
  parameters: z.object({}),
  execute: (_args, { context }) => ({
    widget: {
      type: 'Card',
      title: context.user.name,
      subtitle: context.user.email,
      children: context.user.image
        ? [{ type: 'Image', src: context.user.image, alt: 'Profile photo' }]
        : [{ type: 'Text', value: 'No profile photo yet.', color: 'muted' }],
    },
  }),
});

const myOrganizations = tool<z.ZodObject, ChatContext>({
  name: 'list_my_organizations',
  description: 'List the organizations the user belongs to, with their role.',
  parameters: z.object({}),
  execute: async (_args, { context }) => {
    const organizations = await context.organizations();
    if (organizations.length === 0) return 'The user has no organizations.';
    return {
      widget: {
        type: 'ListView',
        title: 'Your organizations',
        items: organizations.map((organization) => ({
          title: organization.name,
          subtitle: organization.slug,
          badge: organization.role,
        })),
      },
    };
  },
});

// Changes data, so the user must approve it in the chat first.
const renameMe = tool({
  name: 'change_my_name',
  description: "Change the signed-in user's display name.",
  parameters: z.object({ name: z.string().min(1).max(100) }),
  needsApproval: true,
  execute: async ({ name }, { context }: { context: ChatContext }) => {
    await context.rename(name);
    return `Name changed to ${name}.`;
  },
});

const routineLine = (routine: RoutineSummary) =>
  `${routine.name} (${routine.cron}, ${routine.timezone})`;

const listRoutines = tool({
  name: 'list_routines',
  description: "List the user's routines (scheduled agent tasks) with ids.",
  parameters: z.object({}),
  execute: async (_args, { context }: { context: ChatContext }) => {
    const routines = await context.routines.list();
    if (routines.length === 0) return 'The user has no routines.';
    return {
      widget: {
        type: 'ListView',
        title: 'Your routines',
        items: routines.map((routine) => ({
          title: routine.name,
          subtitle: `${routine.cron} (${routine.timezone}) · id ${routine.id}`,
          badge: routine.enabled ? 'on' : 'paused',
          badgeColor: routine.enabled ? 'success' : 'muted',
        })),
      },
    };
  },
});

// The three below change data, so the user approves each one in the chat.
const createRoutine = tool({
  name: 'create_routine',
  description:
    'Create a routine: a prompt the agent runs on a schedule. ' +
    'cron has 5 fields (minute hour day month weekday), at most every 15 ' +
    'minutes. timezone is an IANA name like Africa/Lagos; ask if unknown.',
  parameters: z.object({
    name: z.string().min(1).max(100),
    prompt: z.string().min(1).max(4000),
    cron: z.string().max(100),
    timezone: z.string().max(100),
  }),
  needsApproval: true,
  execute: async (input, { context }: { context: ChatContext }) =>
    `Created: ${routineLine(await context.routines.create(input))}.`,
});

const setRoutineEnabled = tool({
  name: 'set_routine_enabled',
  description: 'Pause (false) or resume (true) a routine, by its id.',
  parameters: z.object({ id: z.string(), enabled: z.boolean() }),
  needsApproval: true,
  execute: async ({ id, enabled }, { context }: { context: ChatContext }) => {
    const routine = await context.routines.setEnabled(id, enabled);
    return `${routine.name} is now ${routine.enabled ? 'on' : 'paused'}.`;
  },
});

const deleteRoutine = tool({
  name: 'delete_routine',
  description: 'Delete a routine, by its id.',
  parameters: z.object({ id: z.string() }),
  needsApproval: true,
  execute: async ({ id }, { context }: { context: ChatContext }) => {
    await context.routines.remove(id);
    return 'Routine deleted.';
  },
});

// ── Guardrails ───────────────────────────────────────────────────────────

// Stops messages that look like they carry a secret key or password.
const secretLike =
  /(sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|password\s*[:=]\s*\S+)/i;

const noSecretsIn: InputGuardrail<ChatContext> = {
  name: 'no_secrets_in',
  execute: ({ input }) => ({
    tripwireTriggered: secretLike.test(input),
    outputInfo: 'Please do not paste keys or passwords into the chat.',
  }),
};

// Stops any answer that contains one of our own secrets.
const noSecretsOut = (secrets: string[]): OutputGuardrail<ChatContext> => ({
  name: 'no_secrets_out',
  execute: ({ output }) => {
    const text = typeof output === 'string' ? output : JSON.stringify(output);
    return {
      tripwireTriggered: secrets.some(
        (secret) => secret.length >= 8 && text.includes(secret),
      ),
    };
  },
});

// ── Agents ───────────────────────────────────────────────────────────────

// The chat starts with the main agent. It answers itself, hands the chat to a
// specialist (Account, Research, Routines), asks the Writer for drafts, or hands it to a
// person on our team.
export function createChatAgent(settings: AgentSettings): Agent<ChatContext> {
  const account = new Agent<ChatContext>({
    name: 'Account',
    handoffDescription: 'Profile, name changes and organizations.',
    instructions:
      'You help with the user’s own account: profile, name and organizations. ' +
      'Use your tools and show results as widgets.',
    tools: [myProfile, myOrganizations, renameMe as FunctionTool<ChatContext>],
    widgets: true,
  });

  const routines = new Agent<ChatContext>({
    name: 'Routines',
    handoffDescription: 'Scheduled tasks: create, list, pause, delete.',
    instructions:
      'You manage the user’s routines: prompts the agent runs on a schedule. ' +
      'Turn what the user says ("every weekday at 8") into a cron pattern. ' +
      'List routines first when you need an id.',
    tools: [
      listRoutines,
      createRoutine,
      setRoutineEnabled,
      deleteRoutine,
    ] as FunctionTool<ChatContext>[],
    widgets: true,
  });

  const research = new Agent<ChatContext>({
    name: 'Research',
    handoffDescription: 'Questions that need the web: news, facts, pages.',
    instructions:
      'You answer questions by searching the web and reading pages. ' +
      'Say where each fact came from.',
    tools: [webSearch(), webFetch()],
    widgets: true,
  });

  // Used as a tool, not a handoff: it writes, the main agent keeps the chat.
  const writer = new Agent<ChatContext>({
    name: 'Writer',
    instructions:
      'You write clear, short text: emails, posts, summaries. Plain English.',
    modelSettings: { temperature: 0.7 },
  });

  const mcpServers = settings.mcpUrl
    ? [
        new MCPServerStreamableHttp({
          name: 'mcp',
          url: settings.mcpUrl,
          requireApproval: true,
        }),
      ]
    : [];

  const options = {
    instructions: ({ context }: { context: ChatContext }) =>
      `You are Agentic, a helpful assistant. The user is ${context.user.name}. ` +
      'Keep answers short and plain. Show data as widgets when it helps. ' +
      'Hand account questions to Account, web questions to Research and ' +
      'scheduled or repeating tasks to Routines. ' +
      'Use the writer tool for drafts. If the user asks for a person, ' +
      'or you cannot help, hand the chat to a human.',
    tools: [
      writer.asTool({
        toolName: 'write_text',
        toolDescription: 'Draft an email, post or summary.',
      }),
      humanHandoff<ChatContext>({
        onHandoff: ({ sessionId, reason }) =>
          settings.onHumanHandoff({ sessionId, reason }),
      }),
    ],
    handoffs: [account, research, routines],
    inputGuardrails: [noSecretsIn],
    outputGuardrails: [noSecretsOut(settings.secrets)],
    widgets: true,
    mcpServers,
  };

  return new Agent<ChatContext>({ name: 'Agentic', ...options });
}
