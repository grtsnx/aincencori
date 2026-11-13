import { describe, expect, it, vi } from 'vitest';
import { type ChatContext, createChatAgent } from '@/config/agents/agents.js';
import { sessionIdOf } from '@/modules/chat/chat.service.js';

const settings = {
  secrets: ['super-secret-value'],
  onHumanHandoff: vi.fn(),
};

const context: ChatContext = {
  user: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
  organizations: () => Promise.resolve([]),
  rename: () => Promise.resolve(),
};
const runContext = { context, sessionId: '', agentName: 'Agentic' };

describe('chat agents', () => {
  it('builds the main agent with widgets, specialists, tools and guardrails', async () => {
    const agent = createChatAgent(settings);

    expect(agent.name).toBe('Agentic');
    expect(agent.widgets).toBe(true);
    expect(agent.handoffs.map((a) => a.name)).toEqual(['Account', 'Research']);
    expect(agent.tools.map((t) => t.name)).toEqual([
      'write_text',
      'handoff_to_human',
    ]);
    expect(agent.mcpServers).toEqual([]);
    await expect(agent.resolveInstructions(runContext)).resolves.toContain(
      'The user is Ada.',
    );

    const [account, research] = agent.handoffs;
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

  it('can run a dashboard agent and use an MCP server', () => {
    const agent = createChatAgent({
      ...settings,
      cencoriAgentId: 'agent_123',
      mcpUrl: 'https://mcp.example.com/mcp',
    });

    expect(agent.cencoriAgentId).toBe('agent_123');
    expect(agent.mcpServers).toHaveLength(1);
  });
});

describe('sessionIdOf', () => {
  it('reads the session id from done and approval events only', () => {
    expect(sessionIdOf('event: done\ndata: {"sessionId":"ses_1"}')).toBe(
      'ses_1',
    );
    expect(
      sessionIdOf('event: approval\ndata: {"sessionId":"ses_2","state":"x"}'),
    ).toBe('ses_2');
    expect(sessionIdOf('event: text\ndata: {"sessionId":"ses_3"}')).toBe(
      undefined,
    );
    expect(sessionIdOf('event: done\ndata: not json')).toBe(undefined);
  });
});
