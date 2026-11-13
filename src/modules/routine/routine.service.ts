import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { CronExpressionParser } from 'cron-parser';
import { randomUUID } from 'node:crypto';
import {
  maxRoutinesPerUser,
  minRoutineIntervalMinutes,
  routineConcurrency,
} from '@/config/agents/limits.js';
import type {
  ChatSessionDto,
  CreateRoutineDto,
  ListRoutinesQueryDto,
  RoutineDto,
  UpdateRoutineDto,
} from '@/dto';
import { Prisma, type Routine } from '@/generated/prisma/client.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { ChatService } from '../chat/chat.service.js';

// Whose routines: the signed-in user, or the user an agent or MCP app acts for.
export interface Owner {
  user: { id: string };
}

// Background job: one run of one routine.
const runRoutine = 'routine-run';

// Routines: the agent runs a user's prompt on a schedule ("every morning at
// 8, summarize the news"). The queue fires each run at the right time in the
// user's time zone; each run is saved as a chat the user can open.
@Injectable()
export class RoutineService implements OnModuleInit {
  private readonly logger = new Logger(RoutineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bullmq: BullmqService,
    private readonly chat: ChatService,
  ) {}

  onModuleInit(): void {
    this.bullmq.handle<{ routineId: string; manual?: boolean }>(
      runRoutine,
      ({ routineId, manual }) => this.run(routineId, manual ?? false),
      { concurrency: routineConcurrency },
    );
    // Puts every timetable back in line with the database when a worker
    // starts. In the background: with many routines this takes minutes, and
    // jobs (like sign-in emails) must not wait. Each run checks its routine
    // still exists and is on, so nothing wrong runs meanwhile.
    this.bullmq.onWorkerStart(() => {
      void this.reconcileSchedules().catch(() =>
        this.logger.error('Routine schedules could not be reconciled.'),
      );
      return Promise.resolve();
    });
    // Lets the chat agent manage the user's routines ("every morning at 8...").
    this.chat.useRoutines({
      list: (userId) => this.list({ user: { id: userId } }, {}),
      create: (userId, input) => this.create({ user: { id: userId } }, input),
      setEnabled: (userId, id, enabled) =>
        this.update(id, { user: { id: userId } }, { enabled }),
      remove: (userId, id) => this.remove(id, { user: { id: userId } }),
    });
  }

  // The user's routines, newest first, one page at a time.
  async list(auth: Owner, query: ListRoutinesQueryDto): Promise<RoutineDto[]> {
    const routines = await this.prisma.db.routine.findMany({
      where: {
        userId: auth.user.id,
        ...(query.botId ? { botId: query.botId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
    return routines.map(toDto);
  }

  async get(id: string, auth: Owner): Promise<RoutineDto> {
    return toDto(await this.own(id, auth));
  }

  async create(auth: Owner, body: CreateRoutineDto): Promise<RoutineDto> {
    checkSchedule(body.cron, body.timezone);
    if (body.botId) {
      // Only the user's own bot may run their routine.
      const bot = await this.prisma.db.bot.findFirst({
        where: { id: body.botId, userId: auth.user.id },
        select: { id: true },
      });
      if (!bot) throw new BadRequestException('Unknown bot.');
    }
    const data = {
      id: randomUUID(),
      userId: auth.user.id,
      botId: body.botId,
      name: body.name,
      prompt: body.prompt,
      cron: body.cron,
      timezone: body.timezone,
      enabled: body.enabled ?? true,
    };
    let routine: Routine;
    for (let attempt = 0; ; attempt += 1) {
      try {
        routine = await this.prisma.db.$transaction(
          async (tx) => {
            const count = await tx.routine.count({
              where: { userId: auth.user.id },
            });
            if (count >= maxRoutinesPerUser) {
              throw new BadRequestException(
                `You can have up to ${maxRoutinesPerUser} routines.`,
              );
            }
            return tx.routine.create({ data });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (error) {
        if (isSerializationConflict(error) && attempt < 2) continue;
        throw error;
      }
    }
    try {
      await this.sync(routine);
    } catch (error) {
      await this.prisma.db.routine.delete({ where: { id: routine.id } });
      throw error;
    }
    return toDto(routine);
  }

  async update(
    id: string,
    auth: Owner,
    body: UpdateRoutineDto,
  ): Promise<RoutineDto> {
    const current = await this.own(id, auth);
    checkSchedule(body.cron ?? current.cron, body.timezone ?? current.timezone);
    const routine = await this.prisma.db.routine.update({
      where: { id },
      data: body,
    });
    try {
      await this.sync(routine);
    } catch (error) {
      const restored = await this.prisma.db.routine.update({
        where: { id },
        data: {
          botId: current.botId,
          name: current.name,
          prompt: current.prompt,
          cron: current.cron,
          timezone: current.timezone,
          enabled: current.enabled,
        },
      });
      await this.sync(restored).catch(() => {
        this.logger.error(`Routine ${id} schedule needs reconciliation.`);
      });
      throw error;
    }
    return toDto(routine);
  }

  async remove(id: string, auth: Owner): Promise<void> {
    await this.own(id, auth);
    await this.prisma.db.routine.delete({ where: { id } });
    await this.bullmq.unschedule(runRoutine, id).catch(() => {
      // A stale scheduled run sees the missing row and removes its schedule.
      this.logger.warn(`Routine ${id} schedule will be removed by its worker.`);
    });
  }

  // Runs it once now, outside its schedule. The answer arrives as a chat.
  async runNow(id: string, auth: Owner): Promise<RoutineDto> {
    await this.own(id, auth);
    await this.bullmq.add(
      runRoutine,
      { routineId: id, manual: true },
      { attempts: 1 },
    );
    return toDto(await this.own(id, auth));
  }

  // Past runs of a routine (each one is a chat), newest first.
  async runs(
    id: string,
    auth: Owner,
    query: ListRoutinesQueryDto,
  ): Promise<ChatSessionDto[]> {
    await this.own(id, auth);
    return this.prisma.db.chatSession.findMany({
      where: { routineId: id, userId: auth.user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
  }

  // One run, from the queue. Failures are recorded, not retried: a retry
  // would bill the AI again for the same answer.
  private async run(routineId: string, manual: boolean): Promise<void> {
    const routine = await this.prisma.db.routine.findUnique({
      where: { id: routineId },
    });
    // Deleted since (for example with its user): stop its timetable too.
    if (!routine) {
      await this.bullmq.unschedule(runRoutine, routineId);
      return;
    }
    const owner = await this.prisma.db.user.findUnique({
      where: { id: routine.userId },
      select: { id: true },
    });
    if (!owner) {
      await this.bullmq.unschedule(runRoutine, routineId);
      return;
    }
    if (!routine.enabled && !manual) return;
    let status: string;
    try {
      status = await this.chat.runRoutine(routine);
    } catch {
      status = 'failed';
      this.logger.error(`Routine ${routine.id} failed.`);
    }
    await this.prisma.db.routine.updateMany({
      where: { id: routine.id },
      data: { lastRunAt: new Date(), lastStatus: status },
    });
  }

  // Puts the queue's timetable in line with the routine: on or off.
  private async sync(routine: Routine): Promise<void> {
    if (routine.enabled) {
      await this.bullmq.schedule(
        runRoutine,
        routine.id,
        { cron: routine.cron, timezone: routine.timezone },
        { routineId: routine.id },
      );
    } else {
      await this.bullmq.unschedule(runRoutine, routine.id);
    }
  }

  // A page of routines at a time, so memory stays flat however many there are.
  private async reconcileSchedules(): Promise<void> {
    const db = this.prisma.db;
    let after: string | undefined;
    for (;;) {
      const routines = await db.routine.findMany({
        orderBy: { id: 'asc' },
        take: 500,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      });
      if (routines.length === 0) return;
      const ownerIds = [...new Set(routines.map((routine) => routine.userId))];
      const owners = await db.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true },
      });
      const existingOwners = new Set(owners.map((owner) => owner.id));
      for (const routine of routines) {
        if (!existingOwners.has(routine.userId)) {
          await this.bullmq.unschedule(runRoutine, routine.id);
        } else {
          await this.sync(routine);
        }
      }
      after = routines.at(-1)?.id;
    }
  }

  private async own(id: string, auth: Owner): Promise<Routine> {
    const routine = await this.prisma.db.routine.findUnique({ where: { id } });
    if (!routine || routine.userId !== auth.user.id) {
      throw new NotFoundException('Routine not found.');
    }
    return routine;
  }
}

function isSerializationConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  );
}

// A valid cron pattern and time zone, with runs at least
// minRoutineIntervalMinutes apart (keeps costs in check).
export function checkSchedule(cron: string, timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new BadRequestException('Unknown time zone.');
  }
  let times: number[];
  try {
    const schedule = CronExpressionParser.parse(cron, { tz: timezone });
    times = Array.from({ length: 6 }, () => schedule.next().getTime());
  } catch {
    throw new BadRequestException('The schedule is not a valid cron pattern.');
  }
  const gap = Math.min(...times.slice(1).map((time, i) => time - times[i]));
  if (gap < minRoutineIntervalMinutes * 60_000) {
    throw new BadRequestException(
      `Routines can run at most every ${minRoutineIntervalMinutes} minutes.`,
    );
  }
}

// When an enabled routine runs next.
function nextRunAt(routine: Routine): string | null {
  if (!routine.enabled) return null;
  try {
    return CronExpressionParser.parse(routine.cron, { tz: routine.timezone })
      .next()
      .toISOString();
  } catch {
    return null;
  }
}

function toDto(routine: Routine): RoutineDto {
  return {
    id: routine.id,
    name: routine.name,
    botId: routine.botId,
    prompt: routine.prompt,
    cron: routine.cron,
    timezone: routine.timezone,
    enabled: routine.enabled,
    nextRunAt: nextRunAt(routine),
    lastRunAt: routine.lastRunAt,
    lastStatus: routine.lastStatus,
    createdAt: routine.createdAt,
    updatedAt: routine.updatedAt,
  };
}
