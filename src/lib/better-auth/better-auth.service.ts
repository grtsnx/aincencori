import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { baseAuthOptions } from '@/config/better-auth.js';
import type { PrismaClient } from '@/generated/prisma/client.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

interface AuthSettings {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  cookieDomain?: string;
}

function createAuth(prisma: PrismaClient, settings: AuthSettings) {
  return betterAuth({
    ...baseAuthOptions,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: settings.secret,
    baseURL: settings.baseURL,
    trustedOrigins: settings.trustedOrigins,
    advanced: settings.cookieDomain
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: settings.cookieDomain,
          },
        }
      : undefined,
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<
  Awaited<ReturnType<Auth['api']['getSession']>>
>;

// Hands Better Auth the Prisma client only when it first touches the database,
// so the app (and tests) start without DATABASE_URL.
function lazyClient(prisma: PrismaService): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, key) {
      const value: unknown = Reflect.get(prisma.db, key);
      return typeof value === 'function' ? value.bind(prisma.db) : value;
    },
  });
}

@Injectable()
export class BetterAuthService {
  readonly auth: Auth;
  // Express handler for every route under authBasePath.
  readonly handler: ReturnType<typeof toNodeHandler>;
  private readonly logger = new Logger(BetterAuthService.name);

  constructor(config: ConfigService, prisma: PrismaService) {
    this.auth = createAuth(lazyClient(prisma), {
      secret: this.secret(config),
      baseURL: config.getOrThrow<string>('BETTER_AUTH_URL'),
      trustedOrigins: config.getOrThrow<string[]>('CORS_ORIGINS'),
      cookieDomain: config.get<string>('AUTH_COOKIE_DOMAIN'),
    });
    this.handler = toNodeHandler(this.auth);
  }

  // The signed-in user and session for a request, or null.
  getSession(headers: IncomingHttpHeaders): Promise<AuthSession | null> {
    return this.auth.api.getSession({ headers: fromNodeHeaders(headers) });
  }

  // Production always has a secret (the config check requires it). Elsewhere a
  // missing secret gets a random one, so sessions end when the server restarts.
  private secret(config: ConfigService): string {
    const secret = config.get<string>('BETTER_AUTH_SECRET');
    if (secret) return secret;

    if (config.get<string>('NODE_ENV') !== 'test') {
      this.logger.warn(
        'BETTER_AUTH_SECRET is not set. Using a random secret, so sessions end when the server restarts.',
      );
    }
    return randomBytes(32).toString('base64');
  }
}
