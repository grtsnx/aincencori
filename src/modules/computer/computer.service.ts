import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ComputerActions } from '@/config/agents/agents.js';
import { deleteComputerJob } from '@/config/agents/jobs.js';
import {
  computerHourUsd,
  computerIdleSeconds,
  computerMinBilledMs,
  computerOutputChars,
  computerSize,
} from '@/config/agents/limits.js';
import type { ComputerDto, ComputerFilesDto } from '@/dto';
import { Prisma } from '@/generated/prisma/client.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import {
  InstaboxError,
  InstaboxService,
} from '@/lib/instabox/instabox.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { ChatService } from '../chat/chat.service.js';
import { UsageService } from '../usage/usage.service.js';

interface Owner {
  user: { id: string };
}

// Long output is cut, and says so.
const cut = (text: string, max = computerOutputChars) =>
  text.length > max
    ? `${text.slice(0, max)}\n… (cut, ${text.length} characters in all)`
    : text;

// Each user's own cloud computer (an InstaBox machine), where their agents
// run commands and keep files. It is made the first time an agent needs it,
// pauses itself when idle, and its run time counts toward the user's AI
// allowance. No keys or passwords are ever put on it.
@Injectable()
export class ComputerService implements OnModuleInit {
  private readonly logger = new Logger(ComputerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly instabox: InstaboxService,
    private readonly bullmq: BullmqService,
    private readonly usage: UsageService,
    private readonly chat: ChatService,
  ) {}

  onModuleInit(): void {
    this.bullmq.handle<{ machineId: string }>(
      deleteComputerJob,
      async ({ machineId }) => {
        if (this.instabox.isConfigured) await this.instabox.remove(machineId);
      },
    );
    if (this.instabox.isConfigured) {
      this.chat.useComputer((userId) => this.actionsFor(userId));
    }
  }

  // What the agents can do on this user's computer.
  actionsFor(userId: string): ComputerActions {
    return {
      run: async (command, cwd, timeoutSeconds) => {
        await this.usage.assertAllowance(userId);
        const started = Date.now();
        const result = await this.withMachine(userId, (machineId) =>
          this.instabox.run(machineId, command, { cwd, timeoutSeconds }),
        );
        this.count(userId, Date.now() - started);
        return [
          `Exit code: ${result.exitCode}${result.timedOut ? ' (stopped: it ran too long)' : ''}`,
          result.stdout && `Output:\n${cut(result.stdout)}`,
          result.stderr && `Errors:\n${cut(result.stderr, 3000)}`,
          result.truncated && 'Some output was cut by the computer.',
        ]
          .filter(Boolean)
          .join('\n\n');
      },
      read: async (path) => {
        const file = await this.withMachine(userId, (machineId) =>
          this.instabox.read(machineId, path),
        );
        if (file.type === 'dir') {
          const lines = (file.entries ?? []).map(
            (entry) =>
              `${entry.type === 'dir' ? '[folder] ' : ''}${entry.name}${entry.type === 'dir' ? '' : ` (${entry.size} bytes)`}`,
          );
          return `Folder ${file.path}:\n${lines.join('\n') || '(empty)'}`;
        }
        if (file.binary) return `${file.path} is not a text file.`;
        return cut(file.content ?? '');
      },
      write: async (path, content) => {
        const size = await this.withMachine(userId, (machineId) =>
          this.instabox.write(machineId, path, content),
        );
        return `Saved ${path} (${size} bytes).`;
      },
    };
  }

  async status(auth: Owner): Promise<ComputerDto> {
    const row = await this.prisma.db.agentComputer.findUnique({
      where: { userId: auth.user.id },
    });
    return {
      available: this.instabox.isConfigured,
      created: Boolean(row),
      createdAt: row?.createdAt ?? null,
      lastUsedAt: row?.lastUsedAt ?? null,
    };
  }

  // The user looks at the files their agents made.
  async files(auth: Owner, path = '/data/home'): Promise<ComputerFilesDto> {
    const row = await this.prisma.db.agentComputer.findUnique({
      where: { userId: auth.user.id },
    });
    if (!row) throw new NotFoundException('Your agents have no computer yet.');
    const file = await this.instabox
      .read(row.machineId, path)
      .catch((error) => {
        if (error instanceof InstaboxError && error.status === 404) {
          throw new NotFoundException('No such file or folder.');
        }
        throw error;
      });
    return {
      path: file.path,
      type: file.type,
      entries: (file.entries ?? []).map(({ name, type, size }) => ({
        name,
        type,
        size,
      })),
      ...(file.type === 'file' && !file.binary
        ? { content: file.content }
        : {}),
      truncated: file.truncated ?? false,
    };
  }

  // Wipes the computer: its files go. A new one is made when next needed.
  async reset(auth: Owner): Promise<void> {
    const row = await this.prisma.db.agentComputer.findUnique({
      where: { userId: auth.user.id },
    });
    if (!row) return;
    await this.bullmq.add(deleteComputerJob, { machineId: row.machineId });
    await this.prisma.db.agentComputer.deleteMany({
      where: { userId: auth.user.id },
    });
  }

  // Runs work on the user's machine, making it first if needed. If InstaBox
  // no longer has it (deleted there), a new one is made once.
  private async withMachine<T>(
    userId: string,
    work: (machineId: string) => Promise<T>,
  ): Promise<T> {
    const machineId = await this.machineFor(userId);
    try {
      return await work(machineId);
    } catch (error) {
      if (!(error instanceof InstaboxError) || error.status !== 404)
        throw error;
      if (error.code !== 'not_found') throw error;
      await this.prisma.db.agentComputer.deleteMany({ where: { userId } });
      return work(await this.machineFor(userId));
    }
  }

  private async machineFor(userId: string): Promise<string> {
    const db = this.prisma.db;
    const found = await db.agentComputer.findUnique({ where: { userId } });
    if (found) {
      await db.agentComputer.update({
        where: { userId },
        data: { lastUsedAt: new Date() },
      });
      return found.machineId;
    }
    // Names allow a-z, 0-9 and "-": a hash of the user id, never the id.
    const tag = createHash('sha256').update(userId).digest('hex').slice(0, 24);
    const machineId = await this.instabox.create({
      name: `agent-${tag}`,
      metadata: { app: 'agentic', owner: tag },
      vcpus: computerSize.vcpus,
      memMiB: computerSize.memMiB,
      autoSuspendAfterSeconds: computerIdleSeconds,
    });
    try {
      await db.agentComputer.create({ data: { userId, machineId } });
      return machineId;
    } catch (error) {
      // Another request made one at the same moment: keep that one.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.bullmq.add(deleteComputerJob, { machineId });
        const winner = await db.agentComputer.findUniqueOrThrow({
          where: { userId },
        });
        return winner.machineId;
      }
      throw error;
    }
  }

  // The machine's run time counts toward the user's allowance.
  private count(userId: string, ms: number): void {
    const billed = Math.max(ms, computerMinBilledMs);
    void this.usage
      .record(userId, 'computer', {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: (billed / 3_600_000) * computerHourUsd,
      })
      .catch(() => this.logger.error('Computer time was not counted.'));
  }
}
