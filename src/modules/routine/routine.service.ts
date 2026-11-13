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
import type { Routine } from '@/generated/prisma/client.js';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { ChatService } from '../chat/chat.service.js';

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
    this.bullmq.handle<{ routineId: string }>(
      runRoutine,
      ({ routineId }) => this.run(routineId),
      { concurrency: routineConcurrency },
    );
  }

  // The user's routines, newest first, one page at a time.
  async list(
    auth: AuthSession,
    query: ListRoutinesQueryDto,
  ): Promise<RoutineDto[]> {
    const routines = await this.prisma.db.routine.findMany({
      where: { userId: auth.user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
    return routines.map(toDto);
  }

  async get(id: string, auth: AuthSession): Promise<RoutineDto> {
    return toDto(await this.own(id, auth));
  }

  async create(auth: AuthSession, body: CreateRoutineDto): Promise<RoutineDto> {
    checkSchedule(body.cron, body.timezone);
    const count = await this.prisma.db.routine.count({
      where: { userId: auth.user.id },
    });
    if (count >= maxRoutinesPerUser) {
      throw new BadRequestException(
        `You can have up to ${maxRoutinesPerUser} routines.`,
      );
    }
    const routine = await this.prisma.db.routine.create({
      data: {
        id: randomUUID(),
        userId: auth.user.id,
        name: body.name,
        prompt: body.prompt,
        cron: body.cron,
        timezone: body.timezone,
        enabled: body.enabled ?? true,
      },
    });
    await this.sync(routine);
    return toDto(routine);
  }

  async update(
    id: string,
    auth: AuthSession,
    body: UpdateRoutineDto,
  ): Promise<RoutineDto> {
    const current = await this.own(id, auth);
    checkSchedule(body.cron ?? current.cron, body.timezone ?? current.timezone);
    const routine = await this.prisma.db.routine.update({
      where: { id },
      data: body,
    });
    await this.sync(routine);
    return toDto(routine);
  }

  async remove(id: string, auth: AuthSession): Promise<void> {
    await this.own(id, auth);
    await this.bullmq.unschedule(runRoutine, id);
    await this.prisma.db.routine.delete({ where: { id } });
  }

  // Runs it once now, outside its schedule. The answer arrives as a chat.
  async runNow(id: string, auth: AuthSession): Promise<RoutineDto> {
    await this.own(id, auth);
    await this.bullmq.add(runRoutine, { routineId: id }, { attempts: 1 });
    return toDto(await this.own(id, auth));
  }

  // Past runs of a routine (each one is a chat), newest first.
  async runs(
    id: string,
    auth: AuthSession,
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
  private async run(routineId: string): Promise<void> {
    const routine = await this.prisma.db.routine.findUnique({
      where: { id: routineId },
    });
    // Deleted since (for example with its user): stop its timetable too.
    if (!routine) {
      await this.bullmq.unschedule(runRoutine, routineId);
      return;
    }
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

  private async own(id: string, auth: AuthSession): Promise<Routine> {
    const routine = await this.prisma.db.routine.findUnique({ where: { id } });
    if (!routine || routine.userId !== auth.user.id) {
      throw new NotFoundException('Routine not found.');
    }
    return routine;
  }
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
