import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedisService } from '@/lib/redis/redis.service.js';

// Tests use the in-memory store, which follows the same rules as Redis.
const service = () =>
  new RedisService({ get: () => 'test', getOrThrow: () => '' } as never);

describe('RedisService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores values until they expire, and reads one-time values once', async () => {
    vi.useFakeTimers();
    const redis = service();

    await redis.set('session', 'abc', 60);
    expect(await redis.get('session')).toBe('abc');
    vi.advanceTimersByTime(61_000);
    expect(await redis.get('session')).toBeNull();

    await redis.set('code', '123456');
    expect(await redis.getAndDelete('code')).toBe('123456');
    expect(await redis.getAndDelete('code')).toBeNull();
  });

  it('counts in a window that starts at the first hit', async () => {
    vi.useFakeTimers();
    const redis = service();

    expect(await redis.count('hits', 10)).toBe(1);
    vi.advanceTimersByTime(9_000);
    expect(await redis.count('hits', 10)).toBe(2);
    vi.advanceTimersByTime(2_000); // 11s after the first hit
    expect(await redis.count('hits', 10)).toBe(1);
  });

  it('blocks a key once it goes over the limit', async () => {
    const redis = service();

    const first = await redis.throttle('ip', 60_000, 2, 60_000);
    await redis.throttle('ip', 60_000, 2, 60_000);
    const third = await redis.throttle('ip', 60_000, 2, 60_000);

    expect(first).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(third).toMatchObject({ totalHits: 3, isBlocked: true });
    expect(third.timeToBlockExpire).toBeGreaterThan(0);
  });
});
