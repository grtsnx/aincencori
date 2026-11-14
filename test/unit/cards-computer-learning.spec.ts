import { describe, expect, it, vi } from 'vitest';
import { approvalCard } from '@/config/agents/cards.js';
import { InstaboxService } from '@/lib/instabox/instabox.service.js';
import { describeCron } from '@/middleware';
import { BotService } from '@/modules/bot/bot.service.js';
import { ComputerService } from '@/modules/computer/computer.service.js';

describe('approval cards', () => {
  it('says schedules in plain words, and shows unknown ones as they are', () => {
    expect(describeCron('0 8 * * *')).toBe('Every day at 08:00');
    expect(describeCron('30 9 * * 1-5')).toBe('Every weekdays at 09:30');
    expect(describeCron('0 18 * * 5')).toBe('Every Friday at 18:00');
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
    expect(describeCron('0 7 1 * *')).toBe('Every month on day 1 at 07:00');
    expect(describeCron('0 8 1 6 *')).toBe('Cron: 0 8 1 6 *');
  });

  it('shows an app tool’s exact values, and cuts long ones', () => {
    const card = approvalCard(
      'gmail_send_email',
      JSON.stringify({ to: 'ada@example.com', body: 'x'.repeat(600) }),
    );
    expect(card.title).toBe('Gmail send email');
    expect(card.fields[0]).toEqual({ label: 'To', value: 'ada@example.com' });
    expect(card.fields[1].value).toMatch(/… \(cut\)$/);
    // Not JSON: still a card, with the raw text.
    expect(approvalCard('start_plan', 'oops').fields).toEqual([
      { label: 'Details', value: 'oops' },
    ]);
  });
});

// A stand-in for InstaBox's API that records what it was asked.
function fakeInstabox() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const service = new InstaboxService({
    get: () => 'ibk_test',
  } as never);
  service.fetch = (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body });
    const json = (status: number, data: unknown) =>
      Promise.resolve(Response.json(data, { status }));
    if (method === 'POST' && url.pathname === '/v1/machines') {
      return json(202, { id: 'op_1', machineId: 'm_1', state: 'queued' });
    }
    if (url.pathname === '/v1/operations/op_1') {
      return json(200, { id: 'op_1', machineId: 'm_1', state: 'succeeded' });
    }
    if (url.pathname.endsWith('/wake')) {
      return json(409, { error: { code: 'machine_not_running' } });
    }
    if (url.pathname.endsWith('/exec')) {
      return json(200, {
        stdout: '42\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });
    }
    if (url.pathname.endsWith('/files') && method === 'GET') {
      return json(200, {
        path: '/data/home/a.txt',
        type: 'file',
        content: 'hello',
        truncated: false,
      });
    }
    if (method === 'PUT') return json(201, { size: 5, created: true });
    return json(404, { error: { code: 'not_found', message: 'No.' } });
  };
  return { service, calls };
}

describe('agent computer', () => {
  const setup = (existing: { machineId: string } | null = null) => {
    const { service: instabox, calls } = fakeInstabox();
    const db = {
      agentComputer: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const usage = {
      assertAllowance: vi.fn().mockResolvedValue(undefined),
      record: vi.fn().mockResolvedValue(undefined),
    };
    const computer = new ComputerService(
      { db } as never,
      instabox,
      { handle: vi.fn(), add: vi.fn() } as never,
      usage as never,
      { useComputer: vi.fn() } as never,
    );
    return { computer, calls, db, usage };
  };

  it('makes the computer the first time, runs the command and counts the time', async () => {
    const { computer, calls, db, usage } = setup();

    const out = await computer
      .actionsFor('user-1')
      .run('python3 -c "print(6*7)"');

    expect(out).toContain('Exit code: 0');
    expect(out).toContain('42');
    const created = calls.find((c) => c.path === '/v1/machines');
    const body = JSON.parse(String(created?.body)) as Record<string, unknown>;
    // Never the user's id or any secret: a hash names it.
    expect(body).toMatchObject({ vcpus: 4, memMiB: 8192, vault: false });
    expect(String(body.name)).toMatch(/^agent-[0-9a-f]{24}$/);
    expect(JSON.stringify(body)).not.toContain('user-1');
    expect(db.agentComputer.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', machineId: 'm_1' },
    });
    expect(usage.assertAllowance).toHaveBeenCalledWith('user-1');
    await vi.waitFor(() =>
      expect(usage.record).toHaveBeenCalledWith(
        'user-1',
        'computer',
        expect.objectContaining({ costUsd: expect.any(Number) }),
      ),
    );
  });

  it('reuses the computer it has, and writes files', async () => {
    const { computer, calls } = setup({ machineId: 'm_9' });

    await expect(
      computer.actionsFor('user-1').write('/data/home/a.txt', 'hello'),
    ).resolves.toBe('Saved /data/home/a.txt (5 bytes).');

    expect(calls.some((c) => c.path === '/v1/machines')).toBe(false);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.path).toBe(
      '/v1/machines/m_9/files?path=%2Fdata%2Fhome%2Fa.txt&parents=true',
    );
    expect(put?.body).toBe('hello');
  });

  it('checks and records allowance for every action that wakes the computer', async () => {
    const { computer, usage } = setup({ machineId: 'm_9' });
    const actions = computer.actionsFor('user-1');

    await actions.read('/data/home/a.txt');
    await actions.write('/data/home/a.txt', 'hello');
    await computer.files({ user: { id: 'user-1' } });

    expect(usage.assertAllowance).toHaveBeenCalledTimes(3);
    await vi.waitFor(() => expect(usage.record).toHaveBeenCalledTimes(3));
  });

  it('limits agent file reads and writes to the persistent home folder', async () => {
    const { computer, calls, usage } = setup({ machineId: 'm_9' });
    const actions = computer.actionsFor('user-1');

    await expect(actions.read('/etc/passwd')).rejects.toThrow(
      'Computer files are limited to /data/home.',
    );
    await expect(actions.write('../../etc/hosts', 'x')).rejects.toThrow(
      'Computer files are limited to /data/home.',
    );
    expect(calls.some((call) => call.path.includes('/files?'))).toBe(false);
    expect(usage.assertAllowance).not.toHaveBeenCalled();
  });
});

describe('bots learning from their chats', () => {
  const setup = (
    output: unknown,
    options: { pending?: number; memories?: string[] } = {},
  ) => {
    let job: ((data: { sessionId: string }) => Promise<void>) | undefined;
    const db = {
      chatSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 's1',
          userId: 'u1',
          botId: 'b1',
          groupId: null,
          learnedAt: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      bot: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'b1',
          userId: 'u1',
          name: 'Sales Bot',
          instructions: 'Write sales emails.',
        }),
      },
      chatMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            role: 'user',
            text: 'Tola approves every discount above 10%.',
            createdAt: new Date('2026-11-14T09:00:00Z'),
            reactions: [],
          },
          {
            role: 'agent',
            text: 'Got it.',
            createdAt: new Date('2026-11-14T09:00:05Z'),
            reactions: [{ emoji: '👎' }],
          },
        ]),
      },
      botMemory: {
        findMany: vi
          .fn()
          .mockResolvedValue(
            (options.memories ?? []).map((text) => ({ text })),
          ),
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      botSkill: { findMany: vi.fn().mockResolvedValue([]) },
      botSuggestion: {
        count: vi.fn().mockResolvedValue(options.pending ?? 0),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    // remember() also trims old memories.
    (db.botMemory as Record<string, unknown>).deleteMany = vi.fn();
    const cencori = {
      isConfigured: true,
      agentRun: vi
        .fn()
        .mockResolvedValue({ sessionId: 'learn-1', finalOutput: output }),
    };
    const bullmq = {
      handle: vi.fn((name: string, handler: typeof job) => {
        if (name === 'bot-learn') job = handler;
      }),
      add: vi.fn().mockResolvedValue(undefined),
    };
    const service = new BotService(
      { db } as never,
      cencori as never,
      bullmq as never,
      {} as never,
      { useBots: vi.fn() } as never,
      {} as never,
      { assertAllowance: vi.fn().mockResolvedValue(undefined) } as never,
      { log: vi.fn() } as never,
    );
    service.onModuleInit();
    const learn = () => {
      if (!job) throw new Error('The learning job was not registered.');
      return job({ sessionId: 's1' });
    };
    return { db, cencori, learn };
  };

  it('keeps new facts about the team, and saves suggestions for the user to accept', async () => {
    const { db, cencori, learn } = setup(
      {
        memories: [
          'Tola approves every discount above 10%.',
          'Already known fact.',
          'The password: hunter2',
        ],
        suggestions: [
          {
            kind: 'instructions',
            title: 'Ask Tola about big discounts',
            reason: 'The user said Tola approves discounts above 10%.',
            instructions: 'Write sales emails. Discounts above 10% need Tola.',
            skill: null,
          },
        ],
      },
      { memories: ['already known fact.'] },
    );

    await learn();

    // The chat (with the 👎) went to the learner.
    const input = String(cencori.agentRun.mock.calls[0][1]);
    expect(input).toContain('<untrusted source="chat transcript">');
    expect(input).toContain('Tola approves every discount above 10%.');
    expect(input).toContain('[the user reacted 👎]');
    // Only the new, safe fact is kept.
    expect(db.botMemory.create).toHaveBeenCalledTimes(1);
    expect(db.botMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          text: 'Tola approves every discount above 10%.',
        }),
      }),
    );
    expect(db.botSuggestion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'instructions',
        instructions: 'Write sales emails. Discounts above 10% need Tola.',
      }),
    });
    // Next time it reads only newer messages.
    expect(db.chatSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { learnedAt: new Date('2026-11-14T09:00:05Z') },
    });
  });

  it('suggests nothing more once enough suggestions are waiting', async () => {
    const { db, learn } = setup(
      {
        memories: [],
        suggestions: [
          {
            kind: 'skill',
            title: 'Weekly report',
            reason: 'Asked three times.',
            instructions: null,
            skill: {
              name: 'weekly-report',
              description: 'The Friday report.',
              instructions: '1. Pull deals.',
            },
          },
        ],
      },
      { pending: 5 },
    );

    await learn();

    expect(db.botSuggestion.create).not.toHaveBeenCalled();
  });
});

describe('agent computer, InstaBox answers', () => {
  it('carries on when a running machine answers a wake-up with itself', async () => {
    const service = new InstaboxService({ get: () => 'ibk_test' } as never);
    const calls: string[] = [];
    service.fetch = (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (url.pathname.endsWith('/wake')) {
        return Promise.resolve(
          Response.json({ id: 'm_1', state: 'running' }, { status: 200 }),
        );
      }
      return Promise.resolve(
        Response.json({ stdout: 'ok', exitCode: 0 }, { status: 200 }),
      );
    };

    await expect(service.run('m_1', 'echo ok')).resolves.toMatchObject({
      stdout: 'ok',
    });
    // No look-up of the machine id as if it were a wake-up job.
    expect(calls).toEqual([
      'POST /v1/machines/m_1/wake',
      'POST /v1/machines/m_1/exec',
    ]);
  });

  it('never passes on InstaBox’s own error words (they can name our account)', async () => {
    const service = new InstaboxService({ get: () => 'ibk_test' } as never);
    service.fetch = () =>
      Promise.resolve(
        Response.json(
          {
            error: {
              code: 'quota_exceeded',
              message: 'sandbox limit reached in org owner@example.com',
            },
          },
          { status: 429 },
        ),
      );

    const error = await service
      .create({
        name: 'agent-x',
        metadata: {},
        vcpus: 4,
        memMiB: 8192,
        autoSuspendAfterSeconds: 300,
      })
      .then(
        () => new Error('created'),
        (caught: Error) => caught,
      );

    expect(error.message).toBe(
      'The cloud computer service is full right now. Try again later.',
    );
    expect(error.message).not.toContain('@');
  });
});

describe('the computer’s browser', () => {
  const setup = (stdout: string) => {
    const commands: string[] = [];
    const instabox = new InstaboxService({ get: () => 'ibk_test' } as never);
    instabox.fetch = (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/wake')) {
        return Promise.resolve(Response.json({ id: 'm_9', state: 'running' }));
      }
      commands.push(String(JSON.parse(String(init?.body)).cmd));
      return Promise.resolve(Response.json({ stdout, exitCode: 0 }));
    };
    const computer = new ComputerService(
      {
        db: {
          agentComputer: {
            findUnique: vi.fn().mockResolvedValue({ machineId: 'm_9' }),
            update: vi.fn().mockResolvedValue({}),
          },
        },
      } as never,
      instabox,
      { handle: vi.fn(), add: vi.fn() } as never,
      {
        assertAllowance: vi.fn().mockResolvedValue(undefined),
        record: vi.fn().mockResolvedValue(undefined),
      } as never,
      { useComputer: vi.fn() } as never,
    );
    return { actions: computer.actionsFor('user-1'), commands };
  };

  it('reads a page after its JavaScript runs, as plain text', async () => {
    const { actions, commands } = setup(
      '<html><body><h1>Lagos</h1><p>31°C, sunny</p><script>x()</script></body></html>',
    );

    const text = await actions.browse('https://weather.example/lagos');

    expect(text).toContain('Lagos');
    expect(text).toContain('31°C, sunny');
    expect(text).not.toContain('x()');
    expect(commands[0]).toContain('chromium');
    expect(commands[0]).toContain("'https://weather.example/lagos'");
  });

  it('only opens web pages, and keeps pictures in the home folder', async () => {
    const { actions, commands } = setup('');

    await expect(actions.browse('file:///etc/passwd')).rejects.toThrow(
      'Only http and https pages',
    );
    await expect(
      actions.screenshot('https://example.com', '/etc/cron.d/x.png'),
    ).rejects.toThrow('Computer files are limited to /data/home.');
    expect(commands).toEqual([]);
  });
});
