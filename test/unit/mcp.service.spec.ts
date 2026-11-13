import { NotFoundException } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import { McpService } from '@/modules/mcp/mcp.service.js';

vi.mock('@better-auth/mcp', () => ({ requireMcpAuth: () => vi.fn() }));

// An MCP client talking to our tools as user "u1", in memory.
async function connect() {
  const routines = {
    list: vi.fn().mockResolvedValue([{ id: 'r1', name: 'Morning news' }]),
    create: vi.fn().mockResolvedValue({ id: 'r2' }),
    update: vi.fn(),
    remove: vi
      .fn()
      .mockRejectedValue(new NotFoundException('Routine not found.')),
    runNow: vi.fn(),
    runs: vi.fn(),
  };
  const chats = {
    list: vi.fn().mockResolvedValue([]),
    messages: vi.fn(),
    remove: vi.fn(),
    ask: vi.fn().mockResolvedValue({
      chatId: 'ses_1',
      answeredBy: 'Sales Bot',
      answer: 'Done.',
      needsApproval: false,
    }),
  };
  const bots = {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'b1' }),
    addMemory: vi.fn().mockResolvedValue({ id: 'm1' }),
  };
  const groups = { create: vi.fn().mockResolvedValue({ id: 'g1' }) };
  const integrations = { apps: vi.fn().mockResolvedValue([]) };
  const prisma = {
    db: {
      chatSession: { findFirst: vi.fn().mockResolvedValue(null) },
      user: {
        findUniqueOrThrow: vi.fn().mockRejectedValue(new Error('db password')),
      },
    },
  };
  const service = new McpService(
    { getOrThrow: () => 'https://api.example.com/mcp' } as never,
    { auth: {} } as never,
    prisma as never,
    routines as never,
    chats as never,
    bots as never,
    groups as never,
    integrations as never,
  );
  const server = (
    service as unknown as { serverFor(userId: string): McpServer }
  ).serverFor('u1');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const text = (result: unknown) =>
    (result as { content: { text: string }[] }).content[0].text;
  return { client, routines, chats, bots, groups, prisma, text };
}

describe('MCP server', () => {
  it('offers the user services and nothing from admin', async () => {
    const { client } = await connect();

    const names = (await client.listTools()).tools.map((tool) => tool.name);

    // Every user service has its tools.
    for (const name of [
      'get_profile',
      'list_organizations',
      'list_chats',
      'get_chat_messages',
      'send_message',
      'delete_chat',
      'list_bots',
      'create_bot',
      'update_bot',
      'delete_bot',
      'list_bot_memories',
      'add_bot_memory',
      'delete_bot_memory',
      'list_bot_skills',
      'add_bot_skill',
      'update_bot_skill',
      'delete_bot_skill',
      'list_groups',
      'create_group',
      'update_group',
      'delete_group',
      'list_routines',
      'create_routine',
      'update_routine',
      'delete_routine',
      'run_routine',
      'list_routine_runs',
      'list_integration_apps',
      'list_integrations',
      'create_integration',
      'connect_integration',
      'update_integration',
      'delete_integration',
    ]) {
      expect(names, name).toContain(name);
    }
    expect(names).toHaveLength(34);
    // Nothing from admin, staff or chats handed to a person.
    expect(names.join(' ')).not.toMatch(
      /admin|staff|ban|impersonate|role|reply|release|user_/,
    );
  });

  it('runs every tool as the signed-in user', async () => {
    const { client, routines, chats, bots, groups, text } = await connect();
    const owner = { user: { id: 'u1' } };

    const listed = await client.callTool({
      name: 'list_routines',
      arguments: {},
    });
    expect(JSON.parse(text(listed))).toEqual([
      { id: 'r1', name: 'Morning news' },
    ]);
    expect(routines.list).toHaveBeenCalledWith(owner, {});

    const input = {
      name: 'News',
      prompt: 'Summarize the news.',
      cron: '0 8 * * *',
      timezone: 'Africa/Lagos',
    };
    await client.callTool({ name: 'create_routine', arguments: input });
    expect(routines.create).toHaveBeenCalledWith(owner, input);

    await client.callTool({ name: 'list_chats', arguments: { limit: 5 } });
    expect(chats.list).toHaveBeenCalledWith(owner, { limit: 5 });

    // Chatting, bots and groups too.
    const sent = await client.callTool({
      name: 'send_message',
      arguments: { message: 'Write to Chidi.', botId: 'b1' },
    });
    expect(JSON.parse(text(sent)).answer).toBe('Done.');
    expect(chats.ask).toHaveBeenCalledWith('u1', {
      message: 'Write to Chidi.',
      botId: 'b1',
    });
    await client.callTool({
      name: 'add_bot_memory',
      arguments: { botId: 'b1', text: 'The company is Acme.' },
    });
    expect(bots.addMemory).toHaveBeenCalledWith('b1', owner, {
      text: 'The company is Acme.',
    });
    await client.callTool({
      name: 'create_group',
      arguments: { name: 'Team', botIds: ['b1', 'b2'] },
    });
    expect(groups.create).toHaveBeenCalledWith(owner, {
      name: 'Team',
      botIds: ['b1', 'b2'],
    });
  });

  it("never reads another user's chat", async () => {
    const { client, chats, prisma, text } = await connect();

    const result = await client.callTool({
      name: 'get_chat_messages',
      arguments: { chatId: 'someone-elses-chat' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe('Chat not found.');
    expect(prisma.db.chatSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'someone-elses-chat', userId: 'u1' },
      }),
    );
    expect(chats.messages).not.toHaveBeenCalled();
  });

  it('shows our own error messages but hides unexpected ones', async () => {
    const { client, text } = await connect();

    const missing = await client.callTool({
      name: 'delete_routine',
      arguments: { id: 'nope' },
    });
    expect(text(missing)).toBe('Routine not found.');

    const crashed = await client.callTool({
      name: 'get_profile',
      arguments: {},
    });
    expect(crashed.isError).toBe(true);
    expect(text(crashed)).toBe('Something went wrong.');
  });
});
