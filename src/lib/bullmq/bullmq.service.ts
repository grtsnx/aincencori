import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type ConnectionOptions,
  type JobsOptions,
  Queue,
  Worker,
} from 'bullmq';
import { sendAlert } from '@/middleware';

// What a job handler gets: the job's data, and which try this is (1, 2, ...).
export type JobHandler<T> = (
  data: T,
  job: { id?: string; attempt: number },
) => Promise<void>;

type WorkerStartHook = () => Promise<void>;

export interface JobOptions {
  // Run later instead of now.
  delayMs?: number;
  // Same id = same job: adding it twice does nothing.
  jobId?: string;
  // How many tries in total (default 5, with growing waits between them).
  attempts?: number;
  // Lower runs first (1 is highest).
  priority?: number;
}

// When a schedule fires: a cron pattern in a time zone, or every N ms.
export type Schedule = { cron: string; timezone: string } | { everyMs: number };

interface Registration {
  handler: JobHandler<unknown>;
  concurrency: number;
}

// Background jobs on BullMQ (Redis or Valkey, REDIS_URL).
// - A module registers its jobs with handle() in onModuleInit.
// - API servers only add jobs; worker servers (src/workers/jobs.ts) run them.
// - add() queues a job; schedule() runs one on a timetable (routines).
// - Failed jobs are retried with growing waits; finished ones are cleaned up.
// Tests run each job straight away, so they need no Redis.
@Injectable()
export class BullmqService implements OnModuleDestroy {
  private readonly logger = new Logger(BullmqService.name);
  private readonly connection: ConnectionOptions;
  private readonly inline: boolean;
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();
  private readonly handlers = new Map<string, Registration>();
  private readonly workerStartHooks: WorkerStartHook[] = [];
  private started = false;
  // Tests only: schedules that would be set.
  private readonly testSchedules = new Map<string, Schedule>();

  private readonly alertWebhookUrl?: string;

  constructor(config: ConfigService) {
    this.inline = config.get<string>('NODE_ENV') === 'test';
    this.alertWebhookUrl = config.get<string>('ALERT_WEBHOOK_URL');
    this.connection = {
      url: config.getOrThrow<string>('REDIS_URL'),
      // Workers wait on Redis; BullMQ needs this off.
      maxRetriesPerRequest: null,
    };
  }

  // Registers what a job does. Call it once per job name, in onModuleInit.
  handle<T>(
    name: string,
    handler: JobHandler<T>,
    options: { concurrency?: number } = {},
  ): void {
    if (this.handlers.has(name)) {
      throw new Error(`Job "${name}" already has a handler.`);
    }
    this.handlers.set(name, {
      handler: handler as JobHandler<unknown>,
      concurrency: options.concurrency ?? 5,
    });
    if (this.started) this.startWorker(name);
  }

  // Runs durable queue reconciliation before workers begin processing jobs.
  onWorkerStart(hook: WorkerStartHook): void {
    if (this.started) {
      throw new Error(
        'Worker startup hooks must be registered before startup.',
      );
    }
    this.workerStartHooks.push(hook);
  }

  // Queues a job. Returns once it is safely stored in Redis.
  async add<T>(name: string, data: T, options: JobOptions = {}): Promise<void> {
    if (this.inline) {
      await this.runInline(name, data);
      return;
    }
    await this.queue(name).add(name, data, this.jobOptions(options));
  }

  // Runs a job on a timetable. Calling it again with the same id updates it.
  async schedule<T>(
    name: string,
    id: string,
    when: Schedule,
    data: T,
  ): Promise<void> {
    if (this.inline) {
      this.testSchedules.set(`${name}:${id}`, when);
      return;
    }
    await this.queue(name).upsertJobScheduler(
      id,
      'cron' in when
        ? { pattern: when.cron, tz: when.timezone }
        : { every: when.everyMs },
      { name, data, opts: this.jobOptions({ attempts: 1 }) },
    );
  }

  // Stops a timetable.
  async unschedule(name: string, id: string): Promise<void> {
    if (this.inline) {
      this.testSchedules.delete(`${name}:${id}`);
      return;
    }
    await this.queue(name).removeJobScheduler(id);
  }

  // Health: checks Redis answers. Throws when it doesn't.
  async ping(): Promise<void> {
    if (this.inline) return;
    const client = await this.queue('health').getBackend().client;
    await client.runCommand('ping', []);
  }

  // Health: how many worker servers are listening for this job.
  async workerCount(name: string): Promise<number> {
    if (this.inline) return 0;
    return this.queue(name).getWorkersCount();
  }

  // Tests only: the timetable set for a job, if any.
  testSchedule(name: string, id: string): Schedule | undefined {
    return this.testSchedules.get(`${name}:${id}`);
  }

  // Starts running jobs. Only the worker process calls this (src/workers/jobs.ts):
  // API servers only add jobs, so busy jobs never slow down the API.
  async startWorkers(): Promise<string[]> {
    if (this.started) return [...this.handlers.keys()];
    for (const hook of this.workerStartHooks) await hook();
    this.started = true;
    if (!this.inline) {
      for (const name of this.handlers.keys()) this.startWorker(name);
    }
    return [...this.handlers.keys()];
  }

  // Lets running jobs finish, then closes the connections.
  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.workers.values()].map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }

  private queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection });
      queue.on('error', () =>
        this.logger.error(`Queue "${name}" lost its Redis connection.`),
      );
      this.queues.set(name, queue);
    }
    return queue;
  }

  private startWorker(name: string): void {
    if (this.inline || this.workers.has(name)) return;
    const registration = this.handlers.get(name);
    if (!registration) return;
    const worker = new Worker(
      name,
      async (job) => {
        await registration.handler(job.data, {
          id: job.id,
          attempt: job.attemptsMade + 1,
        });
      },
      { connection: this.connection, concurrency: registration.concurrency },
    );
    worker.on('failed', (job) => {
      this.logger.error(
        `Job "${name}" ${job?.id ?? ''} failed (try ${job?.attemptsMade ?? '?'}).`,
      );
      // No tries left: tell the team.
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        sendAlert(
          this.alertWebhookUrl,
          `Background job "${name}" failed for good`,
          job.failedReason,
        );
      }
    });
    worker.on('error', () =>
      this.logger.error(`Worker "${name}" lost its Redis connection.`),
    );
    this.workers.set(name, worker);
  }

  private jobOptions(options: JobOptions): JobsOptions {
    return {
      attempts: options.attempts ?? 5,
      backoff: { type: 'exponential', delay: 5_000 },
      delay: options.delayMs,
      jobId: options.jobId,
      priority: options.priority,
      // Keep a short history for debugging, not forever.
      removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    };
  }

  private async runInline(name: string, data: unknown): Promise<void> {
    const registration = this.handlers.get(name);
    if (!registration) throw new Error(`Job "${name}" has no handler.`);
    await registration.handler(data, { attempt: 1 });
  }
}
