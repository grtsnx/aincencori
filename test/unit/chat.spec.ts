import { describe, expect, it, vi } from 'vitest';
import {
  type BotParts,
  type ChatContext,
  createBotAgent,
  createChatAgent,
} from '@/config/agents/agents.js';
import { ChatService, parseEvent } from '@/modules/chat/chat.service.js';

const settings = {
  secrets: ['super-secret-value'],
  onHumanHandoff: vi.fn(),
};

const context: ChatContext = {
  user: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
  organizations: () => Promise.resolve([]),
  rename: () => Promise.resolve(),
  routines: {
    list: () => Promise.resolve([]),
    create: () => Promise.reject(new Error('unused')),
    setEnabled: () => Promise.reject(new Error('unused')),
    remove: () => Promise.resolve(),
  },
};
const runContext = { context, sessionId: '', agentName: 'Agentic' };

describe('chat agents', () => {
  it('builds the main agent with widgets, specialists, tools and guardrails', async () => {
    const agent = createChatAgent(settings);

    expect(agent.name).toBe('Agentic');
    expect(agent.widgets).toBe(true);
    expect(agent.handoffs.map((a) => a.name)).toEqual([
      'Account',
      'Research',
      'Routines',
    ]);
    expect(agent.tools.map((t) => t.name)).toEqual([
      'write_text',
      'handoff_to_human',
    ]);
    expect(agent.mcpServers).toEqual([]);
    await expect(agent.resolveInstructions(runContext)).resolves.toContain(
      'The user is Ada.',
    );

    const [account, research, routines] = agent.handoffs;
    expect(routines.tools.map((t) => t.name)).toEqual([
      'list_routines',
      'create_routine',
      'set_routine_enabled',
      'delete_routine',
    ]);
    expect(account.tools.map((t) => t.name)).toEqual([
      'get_my_profile',
      'list_my_organizations',
      'change_my_name',
    ]);
    expect(research.tools.map((t) => t.name)).toHaveLength(2);
  });

  it('blocks secrets coming in and going out', async () => {
    const agent = createChatAgent(settings);
    const [input] = agent.inputGuardrails;
    const [output] = agent.outputGuardrails;

    const check = (text: string) =>
      Promise.resolve(input.execute({ input: text, agent, runContext }));
    await expect(
      check('my key is sk-abcdefghijklmnopqrstuvwx'),
    ).resolves.toMatchObject({ tripwireTriggered: true });
    await expect(check('Which organizations am I in?')).resolves.toMatchObject({
      tripwireTriggered: false,
    });

    await expect(
      Promise.resolve(
        output.execute({
          output: 'it is super-secret-value',
          agent,
          runContext,
        }),
      ),
    ).resolves.toMatchObject({ tripwireTriggered: true });
    await expect(
      Promise.resolve(
        output.execute({ output: 'You are in Acme.', agent, runContext }),
      ),
    ).resolves.toMatchObject({ tripwireTriggered: false });
  });
});

describe('bot agents', () => {
  const parts = (over: Partial<BotParts> = {}): BotParts => ({
    name: 'Sales Bot',
    description: 'Answers sales emails.',
    instructions: 'Answer sales emails.',
    memories: [],
    skills: [],
    mcpServers: [],
    saveMemory: vi.fn().mockResolvedValue(undefined),
    updateInstructions: vi.fn().mockResolvedValue(undefined),
    ...over,
  });
  const call = (agent: ReturnType<typeof createBotAgent>, name: string) => {
    const found = agent.tools.find((t) => t.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };

  it('works with only a name and instructions', async () => {
    const agent = createBotAgent(settings, parts());

    expect(agent.tools.map((t) => t.name)).toEqual([
      'web_search',
      'web_fetch',
      'save_memory',
      'update_my_instructions',
    ]);
    const text = await agent.resolveInstructions(runContext);
    expect(text).toContain('Answer sales emails.');
    expect(text).not.toContain('What you already know');
    expect(text).not.toContain('Your skills');
  });

  it('knows its memories and lists its skills', async () => {
    const agent = createBotAgent(
      settings,
      parts({
        memories: ['The company is Acme.'],
        skills: [
          {
            name: 'follow-up-email',
            description: 'Write a follow-up email.',
            instructions: '1. Thank them.',
          },
        ],
      }),
    );

    const text = await agent.resolveInstructions(runContext);
    expect(text).toContain('- The company is Acme.');
    expect(text).toContain('- follow-up-email: Write a follow-up email.');
    // The steps are read only when the skill is used.
    expect(text).not.toContain('1. Thank them.');
    expect(agent.tools.map((t) => t.name)).toContain('use_skill');
  });

  it('asks before changing its own instructions, not before saving a fact', () => {
    const agent = createBotAgent(settings, parts());

    expect(
      (call(agent, 'update_my_instructions') as { needsApproval?: unknown })
        .needsApproval,
    ).toBeTruthy();
    expect(
      (call(agent, 'save_memory') as { needsApproval?: unknown }).needsApproval,
    ).toBeFalsy();
  });
});

describe('parseEvent', () => {
  it('reads the name and data of a stream event', () => {
    expect(parseEvent('event: done\ndata: {"sessionId":"ses_1"}')).toEqual({
      name: 'done',
      data: { sessionId: 'ses_1' },
    });
    expect(parseEvent('event: text\ndata: {"delta":"Hi"}').data.delta).toBe(
      'Hi',
    );
    expect(parseEvent('event: done\ndata: not json')).toEqual({
      name: 'done',
      data: {},
    });
  });
});

describe('saving a chat turn', () => {
  const build = () => {
    const upsert = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    const service = new ChatService(
      { get: () => undefined } as never,
      {} as never,
      {} as never,
      { db: { chatSession: { upsert }, chatMessage: { createMany } } } as never,
      { handle: vi.fn(), add: vi.fn() } as never,
    );
    return { service, upsert, createMany };
  };

  // Sends stream text through the recorder, split in odd places like a network would.
  const pass = async (
    service: ChatService,
    body: object,
    stream: string,
  ): Promise<string> => {
    const recorder = (
      service as unknown as {
        recordTurn: (
          userId: string,
          body: object,
        ) => TransformStream<Uint8Array, Uint8Array>;
      }
    ).recordTurn('u1', body);
    const bytes = new TextEncoder().encode(stream);
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) {
          controller.enqueue(bytes.slice(i, i + 7));
        }
        controller.close();
      },
    });
    return new Response(source.pipeThrough(recorder)).text();
  };

  it('saves the question, the answer and its widgets in our database', async () => {
    const { service, upsert, createMany } = build();
    const stream =
      'event: agent\ndata: {"name":"Agentic"}\n\n' +
      'event: text\ndata: {"delta":"You are ","agent":"Agentic"}\n\n' +
      'event: widget\ndata: {"id":"w1","widget":{"type":"Card","children":[]}}\n\n' +
      'event: text\ndata: {"delta":"in Acme.","agent":"Agentic"}\n\n' +
      'event: done\ndata: {"sessionId":"ses_1"}\n\n';

    const out = await pass(
      service,
      { message: 'Which organizations am I in?' },
      stream,
    );

    expect(out).toBe(stream); // The browser gets the stream unchanged.
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ses_1' },
        create: {
          id: 'ses_1',
          userId: 'u1',
          title: 'Which organizations am I in?',
        },
      }),
    );
    const rows = createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sessionId: 'ses_1',
      role: 'user',
      text: 'Which organizations am I in?',
    });
    expect(rows[1]).toMatchObject({
      sessionId: 'ses_1',
      role: 'agent',
      agent: 'Agentic',
      text: 'You are in Acme.',
      widgets: [{ type: 'Card', children: [] }],
    });
  });

  it('keeps the message when the stream ends early in a known chat', async () => {
    const { service, createMany } = build();

    await pass(
      service,
      { sessionId: 'ses_2', message: 'Hello?' },
      'event: with_human\ndata: {}\n\n',
    );

    const rows = createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: 'ses_2', role: 'user' });
  });
});
