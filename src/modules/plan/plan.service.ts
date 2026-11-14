import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createPlannerAgent, type PlanSteps } from '@/config/agents/agents.js';
import { deleteCencoriSessionJob, runPlanJob } from '@/config/agents/jobs.js';
import {
  maxActivePlansPerUser,
  planConcurrency,
} from '@/config/agents/limits.js';
import type { CreatePlanDto, ListPlansQueryDto, PlanDto } from '@/dto';
import type { Plan, PlanStep } from '@/generated/prisma/client.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { CencoriService } from '@/lib/cencori/cencori.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { serializableTransaction } from '@/middleware';
import { ChatService } from '../chat/chat.service.js';
import { UsageService } from '../usage/usage.service.js';

interface Owner {
  user: { id: string };
}

type PlanWithSteps = Plan & { steps: PlanStep[] };

const withSteps = { steps: { orderBy: { position: 'asc' } } } as const;

// Plans still being worked on (they count towards the limit).
const activeStatuses = ['planning', 'running'];

// Tries a plan job gets before the plan is marked failed.
const runAttempts = 3;

// The planner: a user (or the default assistant, for them) gives a big goal.
// A worker asks the Planner agent to split it into steps, then has the
// user's assistant or bot do one step at a time in a single chat, so each
// step sees what the steps before it found. Apps poll the plan to show the
// steps as they run. A step that needs the user's approval pauses the plan;
// the user approves in the chat, then resumes.
@Injectable()
export class PlanService implements OnModuleInit {
  private readonly logger = new Logger(PlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bullmq: BullmqService,
    private readonly cencori: CencoriService,
    private readonly chat: ChatService,
    private readonly usage: UsageService,
  ) {}

  onModuleInit(): void {
    this.chat.usePlans(async (userId, goal) => this.start(userId, { goal }));
    this.bullmq.handle<{ planId: string }>(
      runPlanJob,
      ({ planId }, { attempt }) => this.work(planId, attempt),
      { concurrency: planConcurrency },
    );
  }

  async list(auth: Owner, query: ListPlansQueryDto): Promise<PlanDto[]> {
    const plans = await this.prisma.db.plan.findMany({
      where: { userId: auth.user.id },
      include: withSteps,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
    return plans.map(toDto);
  }

  async get(id: string, auth: Owner): Promise<PlanDto> {
    return toDto(await this.own(id, auth.user.id));
  }

  create(auth: Owner, body: CreatePlanDto): Promise<PlanDto> {
    return this.start(auth.user.id, body);
  }

  async start(userId: string, body: CreatePlanDto): Promise<PlanDto> {
    const db = this.prisma.db;
    if (body.botId) {
      const bot = await db.bot.findFirst({
        where: { id: body.botId, userId, enabled: true },
        select: { id: true },
      });
      if (!bot) throw new NotFoundException('Bot not found.');
    }
    const id = randomUUID();
    await serializableTransaction(db, async (tx) => {
      const active = await tx.plan.count({
        where: { userId, status: { in: activeStatuses } },
      });
      if (active >= maxActivePlansPerUser) {
        throw new BadRequestException(
          `You can run up to ${maxActivePlansPerUser} plans at once. Wait for one to finish or stop one.`,
        );
      }
      await tx.plan.create({
        data: { id, userId, botId: body.botId, goal: body.goal },
      });
    });
    await this.queue(id, () => db.plan.delete({ where: { id } }));
    return toDto(await this.own(id, userId));
  }

  // Stops after the step that is running now.
  async stop(id: string, auth: Owner): Promise<PlanDto> {
    const plan = await this.own(id, auth.user.id);
    if (![...activeStatuses, 'needs-approval'].includes(plan.status)) {
      throw new BadRequestException('This plan is not running.');
    }
    await this.prisma.db.plan.update({
      where: { id },
      data: { status: 'stopped', summary: 'Stopped by you.' },
    });
    return toDto(await this.own(id, auth.user.id));
  }

  // Carries on from the first step that is not done.
  async resume(id: string, auth: Owner): Promise<PlanDto> {
    const userId = auth.user.id;
    await this.own(id, userId);
    const db = this.prisma.db;
    const originalStatus = await serializableTransaction(db, async (tx) => {
      const plan = await tx.plan.findFirst({
        where: { id, userId },
        include: withSteps,
      });
      if (!plan) throw new NotFoundException('Plan not found.');
      if (!['stopped', 'failed', 'needs-approval'].includes(plan.status)) {
        throw new BadRequestException(
          'Only a paused, stopped or failed plan can resume.',
        );
      }
      const active = await tx.plan.count({
        where: { userId, status: { in: activeStatuses } },
      });
      if (active >= maxActivePlansPerUser) {
        throw new BadRequestException(
          `You can run up to ${maxActivePlansPerUser} plans at once. Wait for one to finish or stop one.`,
        );
      }
      await tx.planStep.updateMany({
        where: { planId: id, status: { not: 'done' } },
        data: { status: 'waiting', startedAt: null, finishedAt: null },
      });
      await tx.plan.update({
        where: { id },
        data: {
          status: plan.steps.length > 0 ? 'running' : 'planning',
          summary: null,
        },
      });
      return plan.status;
    });
    await this.queue(id, () =>
      db.plan.update({ where: { id }, data: { status: originalStatus } }),
    );
    return toDto(await this.own(id, userId));
  }

  async remove(id: string, auth: Owner): Promise<void> {
    await this.own(id, auth.user.id);
    // A worker busy with it notices and stops.
    await this.prisma.db.plan.delete({ where: { id } });
  }

  private async queue(id: string, undo: () => Promise<unknown>): Promise<void> {
    try {
      await this.bullmq.add(
        runPlanJob,
        { planId: id },
        { attempts: runAttempts },
      );
    } catch (error) {
      // Not queued: don't leave a plan that never moves.
      await undo().catch(() => undefined);
      throw error;
    }
  }

  // Worker: makes the steps if there are none yet, then does each step in
  // turn, then sums up. Runs again from where it was after a failure.
  private async work(planId: string, attempt: number): Promise<void> {
    const plan = await this.load(planId);
    if (!plan || !activeStatuses.includes(plan.status)) return;
    if (!this.cencori.isConfigured) {
      await this.finish(planId, 'failed', 'The AI service is not set up.');
      return;
    }
    // The planner is not asked when the allowance is used up.
    try {
      await this.usage.assertAllowance(plan.userId);
    } catch (error) {
      if (error instanceof HttpException) {
        await this.finish(planId, 'failed', error.message);
        return;
      }
      throw error;
    }
    const lastTry = attempt >= runAttempts;
    try {
      const steps = plan.steps.length > 0 ? plan.steps : await this.split(plan);
      let chatId = plan.chatId ?? undefined;
      for (const step of steps) {
        if (step.status === 'done') continue;
        // Stopped or deleted meanwhile: leave it there.
        const now = await this.load(planId);
        if (!now || now.status !== 'running') return;
        chatId = await this.doStep(now, step, steps.length, chatId);
        if (!chatId) return;
      }
      const result = await this.chat.ask(plan.userId, {
        message:
          'All steps of the plan are done. Give the user the finished ' +
          'result in full, then one line on what each step did.',
        chatId,
        source: 'plan',
        stopNote: 'This plan paused',
      });
      await this.finish(planId, 'done', result.answer);
    } catch (error) {
      // Out of AI allowance: trying again won't help.
      if (error instanceof HttpException && error.getStatus() === 402) {
        await this.prisma.db.planStep.updateMany({
          where: { planId, status: 'running' },
          data: { status: 'waiting', startedAt: null },
        });
        await this.finish(planId, 'failed', error.message);
        return;
      }
      if (!lastTry) throw error;
      this.logger.warn(`Plan ${planId} failed.`);
      await this.prisma.db.planStep.updateMany({
        where: { planId, status: 'running' },
        data: { status: 'failed', finishedAt: new Date() },
      });
      await this.finish(
        planId,
        'failed',
        'Something went wrong while working on this plan. You can resume it.',
      );
    }
  }

  // Asks the Planner for the steps and saves them.
  private async split(plan: PlanWithSteps): Promise<PlanStep[]> {
    const result = await this.cencori.agentRun(
      createPlannerAgent(),
      plan.goal,
      {
        user: plan.userId,
        metadata: { userId: plan.userId, planId: plan.id },
        maxTurns: 2,
      },
    );
    // The planner's own little chat is not kept.
    await this.bullmq
      .add(deleteCencoriSessionJob, { sessionId: result.sessionId })
      .catch(() => undefined);
    const output = result.finalOutput as PlanSteps | undefined;
    if (!output?.steps.length) throw new Error('The planner gave no steps.');
    const db = this.prisma.db;
    await db.$transaction([
      db.planStep.createMany({
        data: output.steps.map((step, index) => ({
          id: randomUUID(),
          planId: plan.id,
          position: index + 1,
          title: step.title,
          instructions: step.instructions,
        })),
      }),
      db.plan.updateMany({
        where: { id: plan.id, status: 'planning' },
        data: { status: 'running' },
      }),
    ]);
    return (await this.load(plan.id))?.steps ?? [];
  }

  // Does one step in the plan's chat. Returns the chat id, or nothing when
  // the plan must wait for the user.
  private async doStep(
    plan: Plan,
    step: PlanStep,
    total: number,
    chatId: string | undefined,
  ): Promise<string | undefined> {
    const db = this.prisma.db;
    await db.planStep.update({
      where: { id: step.id },
      data: { status: 'running', startedAt: new Date(), finishedAt: null },
    });
    const result = await this.chat.ask(plan.userId, {
      message:
        `You are working through a plan for this goal: ${plan.goal}\n\n` +
        `Step ${step.position} of ${total}: ${step.title}\n${step.instructions}\n\n` +
        'Do only this step now, using what earlier steps found (above in ' +
        'this chat). End with the result of this step.',
      chatId,
      botId: plan.botId ?? undefined,
      title: `Plan: ${plan.goal}`,
      source: 'plan',
      stopNote: 'This plan paused',
    });
    if (!chatId) {
      await db.plan.updateMany({
        where: { id: plan.id },
        data: { chatId: result.chatId },
      });
    }
    if (result.needsApproval) {
      await db.planStep.update({
        where: { id: step.id },
        data: { status: 'needs-approval', result: result.answer },
      });
      await this.finish(
        plan.id,
        'needs-approval',
        `Step ${step.position} needs your approval. Approve it from your approvals inbox, then resume the plan.`,
      );
      return undefined;
    }
    await db.planStep.update({
      where: { id: step.id },
      data: { status: 'done', result: result.answer, finishedAt: new Date() },
    });
    return result.chatId;
  }

  // Sets the outcome, unless the user stopped or deleted the plan meanwhile.
  private async finish(
    planId: string,
    status: string,
    summary: string,
  ): Promise<void> {
    await this.prisma.db.plan.updateMany({
      where: { id: planId, status: { in: activeStatuses } },
      data: { status, summary },
    });
  }

  private load(id: string): Promise<PlanWithSteps | null> {
    return this.prisma.db.plan.findUnique({
      where: { id },
      include: withSteps,
    });
  }

  private async own(id: string, userId: string): Promise<PlanWithSteps> {
    const plan = await this.load(id);
    if (!plan || plan.userId !== userId) {
      throw new NotFoundException('Plan not found.');
    }
    return plan;
  }
}

function toDto(plan: PlanWithSteps): PlanDto {
  return {
    id: plan.id,
    goal: plan.goal,
    botId: plan.botId,
    status: plan.status,
    chatId: plan.chatId,
    summary: plan.summary,
    steps: plan.steps.map((step) => ({
      position: step.position,
      title: step.title,
      instructions: step.instructions,
      status: step.status,
      result: step.result,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
    })),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}
