import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

// InstaBox's API. Fixed, so not a setting.
const apiUrl = 'https://api.instabox.sh';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface FileEntry {
  name: string;
  type: string;
  size: number;
}

export interface FileRead {
  path: string;
  type: 'dir' | 'file' | 'other';
  content?: string;
  binary?: boolean;
  truncated?: boolean;
  entries?: FileEntry[];
}

// An error from InstaBox, with its code ("machine_not_running"...).
export class InstaboxError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InstaboxError';
  }
}

interface Operation {
  id: string;
  machineId: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  error?: { code?: string; message?: string } | null;
}

// Cloud computers for agents, on InstaBox (INSTABOX_API_KEY): each one a
// small Linux VM of its own, with files that stay, which pauses itself when
// idle. Keys and passwords never go into a machine.
@Injectable()
export class InstaboxService {
  private readonly apiKey?: string;
  // Tests swap in a stand-in.
  fetch: typeof fetch = (input, init) => fetch(input, init);

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('INSTABOX_API_KEY');
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  // Makes a machine and waits until it runs. Tries our preferred size and
  // idle time first; plans that don't offer them get InstaBox's defaults.
  async create(input: {
    name: string;
    metadata: Record<string, string>;
    vcpus: number;
    memMiB: number;
    autoSuspendAfterSeconds: number;
  }): Promise<string> {
    const base = { name: input.name, metadata: input.metadata, vault: false };
    let operation: Operation;
    try {
      operation = await this.call<Operation>('POST', '/v1/machines', {
        ...base,
        vcpus: input.vcpus,
        memMiB: input.memMiB,
        autoSuspendAfterSeconds: input.autoSuspendAfterSeconds,
      });
    } catch (error) {
      if (!(error instanceof InstaboxError) || error.status !== 400)
        throw error;
      operation = await this.call<Operation>('POST', '/v1/machines', base);
    }
    const done = await this.waitFor(operation);
    return done.machineId;
  }

  // Runs a shell command. A machine paused for idleness wakes first.
  async run(
    machineId: string,
    command: string,
    options: { cwd?: string; timeoutSeconds?: number } = {},
  ): Promise<CommandResult> {
    await this.wake(machineId);
    const result = await this.call<Partial<CommandResult>>(
      'POST',
      `/v1/machines/${machineId}/exec`,
      {
        cmd: command,
        timeoutSeconds: options.timeoutSeconds ?? 60,
        ...(options.cwd && { cwd: options.cwd }),
      },
      {
        idempotent: false,
        timeoutMs: ((options.timeoutSeconds ?? 60) + 30) * 1000,
      },
    );
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
      timedOut: result.timedOut ?? false,
      truncated: result.truncated ?? false,
    };
  }

  // A text file's content, or a folder's entries.
  async read(machineId: string, path: string): Promise<FileRead> {
    await this.wake(machineId);
    return this.call<FileRead>(
      'GET',
      `/v1/machines/${machineId}/files?path=${encodeURIComponent(path)}`,
      undefined,
      { idempotent: false },
    );
  }

  // Creates or replaces a file (missing folders are made).
  async write(
    machineId: string,
    path: string,
    content: string,
  ): Promise<number> {
    await this.wake(machineId);
    const result = await this.call<{ size: number }>(
      'PUT',
      `/v1/machines/${machineId}/files?path=${encodeURIComponent(path)}&parents=true`,
      content,
      { idempotent: false },
    );
    return result.size;
  }

  // Deletes the machine and its files. Already gone counts as done.
  async remove(machineId: string): Promise<void> {
    try {
      await this.call('DELETE', `/v1/machines/${machineId}`, undefined, {
        headers: { 'X-Confirm-Delete': machineId },
      });
    } catch (error) {
      if (error instanceof InstaboxError && error.status === 404) return;
      throw error;
    }
  }

  // Wakes a machine that paused itself; others are left as they are.
  private async wake(machineId: string): Promise<void> {
    try {
      const answer = await this.call<Operation & { type?: string }>(
        'POST',
        `/v1/machines/${machineId}/wake`,
        {},
      );
      // A running machine answers with itself; only a started wake-up is
      // something to wait for.
      const isOperation =
        typeof answer?.id === 'string' && answer.id.startsWith('op_');
      if (isOperation && answer.state !== 'succeeded') {
        await this.waitFor(answer);
      }
    } catch (error) {
      // Already running, or not paused by idleness: carry on.
      if (error instanceof InstaboxError && error.status === 409) return;
      throw error;
    }
  }

  // Follows a machine change until it succeeds or fails (about 2 minutes).
  private async waitFor(operation: Operation): Promise<Operation> {
    let current = operation;
    for (
      let i = 0;
      i < 6 && !['succeeded', 'failed'].includes(current.state);
      i++
    ) {
      current = await this.call<Operation>(
        'GET',
        `/v1/operations/${current.id}?wait=25s`,
        undefined,
        { idempotent: false, timeoutMs: 35_000 },
      );
    }
    if (current.state !== 'succeeded') {
      throw new InstaboxError(
        502,
        current.error?.code ?? 'operation_failed',
        current.error?.message ?? 'The computer could not be prepared.',
      );
    }
    return current;
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    options: {
      idempotent?: boolean;
      timeoutMs?: number;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'The agent computer is not set up: set INSTABOX_API_KEY.',
      );
    }
    const isText = typeof body === 'string';
    const response = await this.fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        'X-API-Key': this.apiKey,
        ...(body !== undefined && {
          'Content-Type': isText
            ? 'application/octet-stream'
            : 'application/json',
        }),
        // Changes to a machine need one; a retry with it is safe.
        ...(options.idempotent !== false &&
          method !== 'GET' && { 'Idempotency-Key': randomUUID() }),
        ...options.headers,
      },
      body:
        body === undefined ? undefined : isText ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    const text = await response.text();
    const data: unknown = text ? safeJson(text) : undefined;
    if (!response.ok) {
      const error = (data as { error?: { code?: string; message?: string } })
        ?.error;
      const code = error?.code ?? 'error';
      throw new InstaboxError(response.status, code, plainError(code, path));
    }
    return data as T;
  }
}

// What the AI and the user see when InstaBox says no. Never InstaBox's own
// words: they can name our InstaBox account (its owner's email).
function plainError(code: string, path: string): string {
  if (code === 'quota_exceeded') {
    return 'The cloud computer service is full right now. Try again later.';
  }
  if (code === 'rate_limited') {
    return 'The cloud computer is busy. Try again in a minute.';
  }
  if (code === 'not_found') {
    return path.includes('/files')
      ? 'No such file or folder on the computer.'
      : 'The computer was not found.';
  }
  if (code === 'spec_not_allowed') return 'This computer size is not allowed.';
  return `The cloud computer could not do that (${code}).`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
