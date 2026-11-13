import { symmetricDecrypt } from 'better-auth/crypto';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailOutboxService } from '@/lib/email/email-outbox.service.js';

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
    getOrThrow: (key: string) =>
      key === 'BETTER_AUTH_SECRET' ? secret : undefined,
  } as never;
  const sender = vi.fn().mockResolvedValue(undefined);
  const service = new EmailOutboxService(config, prisma, sender);
  return { service, create, findMany, updateMany, deleteMany, sender };
}

describe('EmailOutboxService', () => {
  afterEach(() => vi.restoreAllMocks());

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

    expect(sender).toHaveBeenCalledWith(message);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[0]?.[0].data).toMatchObject({
      attempts: { increment: 1 },
      status: 'sending',
    });
    expect(updateMany.mock.calls[1]?.[0].data).toMatchObject({
      status: 'sent',
    });
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
    expect(sender).toHaveBeenCalledWith(message);
  });
});
