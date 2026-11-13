import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PlanService } from '@/modules/plan/plan.service.js';

// A small in-memory stand-in for the plan and step tables.
function createService(options: { approvalAtStep?: number } = {}) {
  type Step = {
    id: string;
    planId: string;
    position: number;
    title: string;
    instructions: string;
    status: string;
    result: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  };
  const plan = {
    id: 'p1',
    userId: 'u1',
    botId: null as string | null,
    goal: 'Compare CRM tools.',
    status: 'planning',
    chatId: null as string | null,
    summary: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let steps: Step[] = [];
  let job:
    | ((data: { planId: string }, meta: { attempt: number }) => Promise<void>)
    | undefined;
  const load = () =>
    Promise.resolve(
      plan.status === 'deleted'
        ? null
        : {
            ...plan,
            steps: [...steps].sort((a, b) => a.position - b.position),
          },
    );
  const db = {
    plan: {
      findUnique: vi.fn(load),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(plan),
      update: vi.fn(({ data }: { data: Partial<typeof plan> }) => {
        Object.assign(plan, data);
        return Promise.resolve(plan);
      }),
      updateMany: vi.fn(
        ({
          where,
          data,
        }: {
          where: { status?: string | { in: string[] } };
          data: Partial<typeof plan>;
        }) => {
          const wanted = where.status;
          const ok =
            wanted === undefined ||
            (typeof wanted === 'string'
              ? plan.status === wanted
              : wanted.in.includes(plan.status));
          if (ok) Object.assign(plan, data);
          return Promise.resolve({ count: ok ? 1 : 0 });
        },
      ),
    },
    planStep: {
      createMany: vi.fn(({ data }: { data: Step[] }) => {
        steps = data.map((step) => ({
          ...step,
          status: 'waiting',
          result: null,
          startedAt: null,
          finishedAt: null,
        }));
        return Promise.resolve({ count: data.length });
      }),
      update: vi.fn(
        ({ where, data }: { where: { id: string }; data: Partial<Step> }) => {
          const step = steps.find((s) => s.id === where.id);
          Object.assign(step ?? {}, data);
          return Promise.resolve(step);
        },
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn((work: Promise<unknown>[]) => Promise.all(work)),
  };
  const bullmq = {
    handle: vi.fn((_name: string, handler: typeof job) => (job = handler)),
    add: vi.fn().mockResolvedValue(undefined),
  };
  const cencori = {
    isConfigured: true,
    agentRun: vi.fn().mockResolvedValue({
      sessionId: 'planner-session',
      finalOutput: {
        steps: [
          { title: 'Find tools', instructions: 'Find three CRM tools.' },
          { title: 'Compare', instructions: 'Compare their prices.' },
        ],
      },
    }),
  };
  const usage = { assertAllowance: vi.fn().mockResolvedValue(undefined) };
  let call = 0;
  const chat = {
    usePlans: vi.fn(),
    ask: vi.fn(() => {
      call += 1;
      return Promise.resolve({
        chatId: 'chat-1',
        answeredBy: 'Agentic',
        answer: `Answer ${call}`,
        needsApproval: call === options.approvalAtStep,
      });
    }),
  };
  const service = new PlanService(
    { db } as never,
    bullmq as never,
    cencori as never,
    chat as never,
    usage as never,
  );
  service.onModuleInit();
  const run = (attempt = 1) => {
    if (!job) throw new Error('The plan job was not registered.');
    return job({ planId: 'p1' }, { attempt });
  };
  return {
    service,
    plan,
    steps: () => steps,
    chat,
    cencori,
    bullmq,
    usage,
    run,
  };
}

describe('PlanService', () => {
  it('splits a goal into steps, does each in one chat, then sums up', async () => {
    const { plan, steps, chat, bullmq, run } = createService();

    await run();

    expect(steps().map((s) => [s.title, s.status, s.result])).toEqual([
      ['Find tools', 'done', 'Answer 1'],
      ['Compare', 'done', 'Answer 2'],
    ]);
    expect(plan).toMatchObject({
      status: 'done',
      chatId: 'chat-1',
      summary: 'Answer 3',
    });
    // Step 1 starts the chat; the rest continue it, so they see earlier work.
    expect(chat.ask.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      expect.objectContaining({ chatId: undefined }),
      expect.objectContaining({ chatId: 'chat-1' }),
      expect.objectContaining({ chatId: 'chat-1' }),
    ]);
    // The planner's own chat at Cencori is removed.
    expect(bullmq.add).toHaveBeenCalledWith('cencori-session-delete', {
      sessionId: 'planner-session',
    });
  });

  it('pauses at a step that needs the user, and carries on later', async () => {
    const { service, plan, steps, chat, run } = createService({
      approvalAtStep: 1,
    });

    await run();
    expect(plan.status).toBe('needs-approval');
    expect(steps().map((s) => s.status)).toEqual(['needs-approval', 'waiting']);
    expect(chat.ask).toHaveBeenCalledTimes(1);

    // The user approved in the chat, then resumes (the queue runs it).
    plan.status = 'running';
    for (const step of steps()) {
      if (step.status !== 'done') step.status = 'waiting';
    }
    await run();
    expect(plan.status).toBe('done');
    expect(steps().every((s) => s.status === 'done')).toBe(true);
    expect(service).toBeDefined();
  });

  it('stops between steps when the user stops it', async () => {
    const { plan, steps, chat, run } = createService();
    chat.ask.mockImplementationOnce(() => {
      plan.status = 'stopped';
      return Promise.resolve({
        chatId: 'chat-1',
        answeredBy: 'Agentic',
        answer: 'Answer 1',
        needsApproval: false,
      });
    });

    await run();

    expect(chat.ask).toHaveBeenCalledTimes(1);
    expect(plan.status).toBe('stopped');
    expect(steps()[1].status).toBe('waiting');
  });

  it('tries again after a failure, and gives up with a reason on the last try', async () => {
    const { plan, cencori, run } = createService();
    cencori.agentRun.mockRejectedValue(new Error('Cencori away'));

    await expect(run(1)).rejects.toThrow('Cencori away');
    expect(plan.status).toBe('planning');

    await run(3);
    expect(plan.status).toBe('failed');
    expect(plan.summary).toContain('You can resume it');
  });

  it('stops at once, without retrying, when the AI allowance is used up', async () => {
    const { plan, usage, chat, run } = createService();
    usage.assertAllowance.mockRejectedValue(
      new HttpException("You have used this month's AI allowance.", 402),
    );

    await run(1);

    expect(plan).toMatchObject({
      status: 'failed',
      summary: expect.stringContaining('allowance'),
    });
    expect(chat.ask).not.toHaveBeenCalled();
  });

  it('says so at once when the AI service is not set up', async () => {
    const { plan, cencori, chat, run } = createService();
    cencori.isConfigured = false;

    await run();

    expect(plan).toMatchObject({
      status: 'failed',
      summary: 'The AI service is not set up.',
    });
    expect(chat.ask).not.toHaveBeenCalled();
  });
});
