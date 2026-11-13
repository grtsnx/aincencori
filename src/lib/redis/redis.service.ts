import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export interface ThrottleResult {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

// Counts a hit in a fixed window and blocks the key once over the limit.
// One script, so the count is right however many API servers share it.
const throttleScript = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
return {hits, ttl, blocked}
`;

// Creates the counter with its lifetime; later hits never extend it.
const counterScript = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return hits
`;

// Fast shared storage on Redis or Valkey (REDIS_URL): sign-in sessions and
// rate-limit counters, shared by every API server.
// Tests keep everything in memory, so they need no Redis.
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client?: Redis;
  // Tests only.
  private readonly memory = new Map<
    string,
    { value: string; expiresAt?: number }
  >();

  constructor(config: ConfigService) {
    if (config.get<string>('NODE_ENV') === 'test') return;
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      // Connects on first use, so the app starts even if Redis is still booting.
      lazyConnect: true,
      // Fail fast instead of queueing requests while Redis is away.
      maxRetriesPerRequest: 2,
      keyPrefix: 'app:',
    });
    this.client.on('error', () =>
      this.logger.error('Lost the Redis connection.'),
    );
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return this.read(key)?.value ?? null;
    return this.client.get(key);
  }

  // ttlSeconds: how long to keep it. Without it the value stays.
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) {
      this.memory.set(key, {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
      });
      return;
    }
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', Math.ceil(ttlSeconds));
    } else {
      await this.client.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.client) {
      this.memory.delete(key);
      return;
    }
    await this.client.del(key);
  }

  // Reads a value and removes it in one step (one-time codes).
  async getAndDelete(key: string): Promise<string | null> {
    if (!this.client) {
      const value = this.read(key)?.value ?? null;
      this.memory.delete(key);
      return value;
    }
    return this.client.getdel(key);
  }

  // Adds one to a counter that expires ttlSeconds after its first hit.
  async count(key: string, ttlSeconds: number): Promise<number> {
    if (!this.client) {
      const hits = Number(this.read(key)?.value ?? 0) + 1;
      const expiresAt =
        this.read(key)?.expiresAt ?? Date.now() + ttlSeconds * 1000;
      this.memory.set(key, { value: String(hits), expiresAt });
      return hits;
    }
    return (await this.client.eval(
      counterScript,
      1,
      key,
      Math.ceil(ttlSeconds),
    )) as number;
  }

  // Rate limit: counts a hit; over the limit the key is blocked for blockMs.
  async throttle(
    key: string,
    windowMs: number,
    limit: number,
    blockMs: number,
  ): Promise<ThrottleResult> {
    let hits: number;
    let ttl: number;
    let blocked: number;
    if (!this.client) {
      hits = await this.count(key, windowMs / 1000);
      ttl = (this.read(key)?.expiresAt ?? Date.now()) - Date.now();
      const block = this.read(`${key}:blocked`);
      if (!block && hits > limit) {
        await this.set(`${key}:blocked`, '1', blockMs / 1000);
      }
      blocked = (this.read(`${key}:blocked`)?.expiresAt ?? 0) - Date.now();
    } else {
      [hits, ttl, blocked] = (await this.client.eval(
        throttleScript,
        2,
        key,
        `${key}:blocked`,
        windowMs,
        limit,
        blockMs || windowMs,
      )) as [number, number, number];
    }
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(ttl / 1000)),
      isBlocked: blocked > 0,
      timeToBlockExpire: Math.max(0, Math.ceil(blocked / 1000)),
    };
  }

  // Health: throws when Redis does not answer.
  async ping(): Promise<void> {
    await this.client?.ping();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  private read(key: string): { value: string; expiresAt?: number } | undefined {
    const entry = this.memory.get(key);
    if (entry?.expiresAt && entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return undefined;
    }
    return entry;
  }
}
