import { symmetricDecrypt } from 'better-auth/crypto';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from '@/lib/email/email.service.js';

const secret = 'outbox-encryption-test-secret';
const message = {
  template: 'sign-in-otp' as const,
  to: 'ada@example.com',
  variables: { otpCode: '123456', userEmail: 'ada@example.com' },
};

function createService(rows: unknown[] = [], updateCounts: number[] = [1, 1]) {
  const create = vi.fn().mockResolvedValue({ id: 'mail_1' });
  const findMany = vi.fn().mockResolvedValue(rows);
  const updateMany = vi.fn().mockImplementation(async () => ({
    count: updateCounts.shift() ?? 1,
  }));
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    db: { emailOutbox: { create, findMany, updateMany, deleteMany } },
  } as never;
  const config = {
    get: () => undefined,
    getOrThrow: (key: string) =>
      key === 'BETTER_AUTH_SECRET' ? secret : undefined,
  } as never;
  // @nestjs/mail's Mailer; only send() is used.
  const sender = vi.fn().mockResolvedValue({ messageId: 'm1' });
  let startHook: (() => Promise<void>) | undefined;
  const bullmq = {
    handle: vi.fn(),
    onWorkerStart: vi.fn((hook: () => Promise<void>) => {
      startHook = hook;
    }),
    add: vi.fn().mockResolvedValue(undefined),
    schedule: vi.fn().mockResolvedValue(undefined),
  };
  const service = new EmailService(
    config,
    prisma,
    { send: sender } as never,
    bullmq as never,
  );
  return {
    service,
    create,
    findMany,
    updateMany,
    deleteMany,
    sender,
    bullmq,
    startHook: () => startHook,
  };
}

describe('EmailService (outbox + @nestjs/mail)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('persists an encrypted payload before returning', async () => {
    const { service, create } = createService();

    await service.enqueue(message.template, message.to, message.variables);

    const payload = create.mock.calls[0]?.[0].data.payload as string;
    await expect(
      symmetricDecrypt({ key: secret, data: payload }),
    ).resolves.toBe(JSON.stringify(message));
    expect(create.mock.calls[0]?.[0].data).toMatchObject({ status: 'pending' });
    expect(payload).not.toContain('123456');
  });

  it('sets up the retry sweep before the worker starts processing jobs', async () => {
    const { service, bullmq, startHook } = createService();
    service.onModuleInit();

    expect(bullmq.schedule).not.toHaveBeenCalled();
    await startHook()?.();

    expect(bullmq.schedule).toHaveBeenCalledWith(
      'email-outbox',
      'every-5-seconds',
      { everyMs: 5_000 },
      {},
    );
  });

  it('claims and sends due messages once', async () => {
    const payload = await (
      await import('better-auth/crypto')
    ).symmetricEncrypt({
      key: secret,
      data: JSON.stringify(message),
    });
    const row = {
      id: 'mail_1',
      payload,
      status: 'pending',
      attempts: 0,
      lockedAt: null,
    };
    const { service, sender, updateMany } = createService([row]);

    await service.processDueMessages(new Date('2026-11-13T00:00:00.000Z'));

    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        to: message.to,
        subject: expect.stringContaining('sign-in code'),
        text: expect.stringContaining('123456'),
        idempotencyKey: expect.any(String),
        retry: false,
      }),
    );
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[0]?.[0].data).toMatchObject({
      attempts: { increment: 1 },
      status: 'sending',
    });
    expect(updateMany.mock.calls[1]?.[0].data).toMatchObject({
      status: 'sent',
    });
  });

  it('starts each message lease when that message is claimed', async () => {
    const payload = await (
      await import('better-auth/crypto')
    ).symmetricEncrypt({
      key: secret,
      data: JSON.stringify(message),
    });
    // 11 emails: 10 go out together, the 11th in the next group.
    const rows = Array.from({ length: 11 }, (_, i) => ({
      id: `mail_${i + 1}`,
      payload,
      status: 'pending',
      attempts: 0,
      lockedAt: null,
    }));
    const start = new Date('2026-11-13T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const { service, sender, updateMany } = createService(rows);
    sender.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date(start.getTime() + 6 * 60_000));
    });

    await service.processDueMessages(start);

    const claim = (id: string) =>
      updateMany.mock.calls
        .map(([call]) => call)
        .find((call) => call.where.id === id && call.data.status === 'sending')
        ?.data.lockedAt;
    expect(claim('mail_1')).toEqual(start);
    expect(claim('mail_11')).toEqual(new Date(start.getTime() + 6 * 60_000));
    expect(sender).toHaveBeenCalledTimes(11);
  });

  it('does not send a message another worker already claimed', async () => {
    const { service, sender, updateMany } = createService(
      [
        {
          id: 'mail_1',
          payload: 'unused',
          status: 'pending',
          attempts: 0,
          lockedAt: null,
        },
      ],
      [0],
    );

    await service.processDueMessages(new Date('2026-11-13T00:00:00.000Z'));

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(sender).not.toHaveBeenCalled();
  });

  it('retries provider failures with delayed availability', async () => {
    const payload = await (
      await import('better-auth/crypto')
    ).symmetricEncrypt({
      key: secret,
      data: JSON.stringify(message),
    });
    const { service, sender, updateMany } = createService([
      {
        id: 'mail_1',
        payload,
        status: 'pending',
        attempts: 0,
        lockedAt: null,
      },
    ]);
    sender.mockRejectedValueOnce(
      new Error('provider detail must not be stored'),
    );
    const errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const now = new Date('2026-11-13T00:00:00.000Z');

    await service.processDueMessages(now);

    const retry = updateMany.mock.calls[1]?.[0].data;
    expect(retry).toMatchObject({
      status: 'pending',
      lastErrorCategory: 'provider-failure',
    });
    expect(retry.availableAt.getTime()).toBeGreaterThan(now.getTime());
    expect(JSON.stringify(retry)).not.toContain('provider detail');
    expect(errorLog.mock.calls[0]?.[0]).toContain('provider-failure');
    expect(errorLog.mock.calls[0]?.[0]).not.toContain('provider detail');
  });

  it('recovers and sends rows held by an expired worker lease', async () => {
    const payload = await (
      await import('better-auth/crypto')
    ).symmetricEncrypt({
      key: secret,
      data: JSON.stringify(message),
    });
    const now = new Date('2026-11-13T00:00:00.000Z');
    const { service, findMany, sender } = createService([
      {
        id: 'mail_stale',
        payload,
        status: 'sending',
        attempts: 1,
        lockedAt: new Date(now.getTime() - 5 * 60_000 - 1),
      },
    ]);

    await service.processDueMessages(now);

    expect(findMany.mock.calls[0]?.[0].where.OR[1]).toMatchObject({
      status: 'sending',
    });
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        to: message.to,
        subject: expect.stringContaining('sign-in code'),
        text: expect.stringContaining('123456'),
        idempotencyKey: expect.any(String),
        retry: false,
      }),
    );
  });

  it('keeps test emails in memory instead of the database', async () => {
    const create = vi.fn();
    const service = new EmailService(
      { get: () => 'test' } as never,
      { db: { emailOutbox: { create } } } as never,
      { send: vi.fn() } as never,
      { handle: vi.fn(), add: vi.fn() } as never,
    );

    await service.enqueue(message.template, message.to, message.variables);

    expect(create).not.toHaveBeenCalled();
    expect(service.lastTestEmail(message.to)).toEqual(message.variables);
  });
});

describe('SendByteTransport', () => {
  const message = {
    from: { name: 'Agentic', address: 'no-reply@example.com' },
    to: [{ address: 'ada@example.com' }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: 'Your code',
    html: '<p>123456</p>',
    text: '123456',
  } as never;
  const options = {
    signal: new AbortController().signal,
    idempotencyKey: 'outbox_1',
    attempt: 1,
  };

  it('posts the email to SendByte with the key and the outbox id', async () => {
    const { SendByteTransport } = await import('@/lib/email/email.module.js');
    const request = vi
      .fn()
      .mockResolvedValue(Response.json({ id: 'em_1' }, { status: 201 }));

    const result = await new SendByteTransport('sk_test_x', request).send(
      message,
      options,
    );

    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://api.sendbyte.africa/v1/emails');
    expect(init.headers.authorization).toBe('Bearer sk_test_x');
    expect(JSON.parse(init.body)).toEqual({
      from: 'Agentic <no-reply@example.com>',
      to: ['ada@example.com'],
      subject: 'Your code',
      html: '<p>123456</p>',
      text: '123456',
      idempotency_key: 'outbox_1',
    });
    expect(result).toEqual({
      accepted: ['ada@example.com'],
      providerMessageId: 'em_1',
    });
  });

  it('fails on an error answer, so the outbox retries', async () => {
    const { SendByteTransport } = await import('@/lib/email/email.module.js');
    const request = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: 'rate_limit_exceeded' } },
          { status: 429 },
        ),
      );

    await expect(
      new SendByteTransport('sk_test_x', request).send(message, options),
    ).rejects.toThrow('SendByte answered 429 (rate_limit_exceeded)');
  });
});

describe('SendByteTransport reply-to', () => {
  it('sends the reply-to address when one is set', async () => {
    const { SendByteTransport } = await import('@/lib/email/email.module.js');
    const request = vi
      .fn()
      .mockResolvedValue(Response.json({ id: 'em_1' }, { status: 201 }));

    await new SendByteTransport('sk_test_x', request).send(
      {
        from: { address: 'no-reply@example.com' },
        to: [{ address: 'ada@example.com' }],
        cc: [],
        bcc: [],
        replyTo: [{ name: 'Support', address: 'support@example.com' }],
        subject: 'Hi',
        text: 'Hi',
      } as never,
      { signal: new AbortController().signal, attempt: 1 },
    );

    expect(JSON.parse(request.mock.calls[0][1].body).reply_to).toBe(
      'Support <support@example.com>',
    );
  });
});
