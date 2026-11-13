import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import {
  createAuthOptions,
  type AuthSettings,
} from '@/config/auth/better-auth.js';
import type { PrismaClient } from '@/generated/prisma/client.js';
import { EmailService } from '@/lib/email/email.service.js';
import {
  buildDicebearUrl,
  DEFAULT_DICEBEAR_STYLE,
  GravatarService,
} from '@/lib/gravatar/gravatar.service.js';
import {
  deleteBotAgentJob,
  deleteFilesJob,
  deleteWorkspaceJob,
  userFilesPrefix,
} from '@/config/agents/jobs.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { RedisService } from '@/lib/redis/redis.service.js';
import { hashValue, verifyHash } from '@/middleware';

function createAuth(prisma: PrismaClient, settings: AuthSettings) {
  return betterAuth({
    ...createAuthOptions(settings),
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
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
export class BetterAuthService implements OnModuleInit {
  readonly auth: Auth;
  private openApi?: Record<string, unknown>;
  // Express handler for every Better Auth route.
  readonly handler: ReturnType<typeof toNodeHandler>;
  private readonly logger = new Logger(BetterAuthService.name);

  constructor(
    private readonly config: ConfigService,
    prisma: PrismaService,
    email: EmailService,
    gravatar: GravatarService,
    redis: RedisService,
    bullmq: BullmqService,
  ) {
    const nodeEnv = config.getOrThrow<string>('NODE_ENV');
    // A provider is on when both its ID and secret are set.
    const provider = (name: 'GOOGLE' | 'GITHUB' | 'LINKEDIN') => {
      const clientId = config.get<string>(`${name}_CLIENT_ID`);
      const clientSecret = config.get<string>(`${name}_CLIENT_SECRET`);
      return clientId && clientSecret ? { clientId, clientSecret } : undefined;
    };

    this.auth = createAuth(lazyClient(prisma), {
      appName: config.getOrThrow<string>('PLATFORM_NAME'),
      baseURL: config.getOrThrow<string>('BETTER_AUTH_URL'),
      appURL: config.getOrThrow<string>('APP_URL'),
      secret: this.secret(nodeEnv),
      trustedOrigins: config.getOrThrow<string[]>('CORS_ORIGINS'),
      cookieDomain: config.get<string>('AUTH_COOKIE_DOMAIN'),
      // Tests never report to the dashboard.
      dashApiKey:
        nodeEnv === 'test'
          ? undefined
          : config.get<string>('BETTER_AUTH_API_KEY'),
      oauth: {
        google: provider('GOOGLE'),
        github: provider('GITHUB'),
        linkedin: provider('LINKEDIN'),
      },
      recaptchaSecretKey: config.get<string>('RECAPTCHA_SECRET_KEY'),
      passkeyRpID: config.getOrThrow<string>('PASSKEY_RP_ID'),
      mcpResource: config.getOrThrow<string>('MCP_RESOURCE_URL'),
      ipAddressHeaders: config.getOrThrow<string[]>('AUTH_IP_HEADERS'),
      trustedProxies: config.getOrThrow<string[]>('AUTH_TRUSTED_PROXIES'),
      trustProxy: nodeEnv === 'production',
      testing: nodeEnv === 'test',
      // Saved to the email outbox, then sent in the background.
      sendEmail: (template, to, variables) =>
        email.enqueue(template, to, variables),
      passwordHasher: { hash: hashValue, verify: verifyHash },
      // Tests never call Gravatar; they get the DiceBear avatar directly.
      secondaryStorage: {
        get: (key) => redis.get(key),
        set: (key, value, ttl) => redis.set(key, value, ttl),
        delete: (key) => redis.delete(key),
        getAndDelete: (key) => redis.getAndDelete(key),
        increment: (key, ttl) => redis.count(key, ttl),
      },
      // A deleted user's chats, routines, bots and integrations go too
      // (messages follow their chat; a routine's timetable stops itself on
      // its next run). Their space and bots at Cencori are removed in the
      // background, which also signs their apps out.
      onUserDeleted: async (userId) => {
        const db = prisma.db;
        const [workspace, bots] = await Promise.all([
          db.agentWorkspace.findUnique({ where: { userId } }),
          db.bot.findMany({
            where: { userId, cencoriAgentId: { not: null } },
            select: { cencoriAgentId: true },
          }),
        ]);
        await db.chatSession.deleteMany({ where: { userId } });
        await db.routine.deleteMany({ where: { userId } });
        await db.botGroup.deleteMany({ where: { userId } });
        await db.bot.deleteMany({ where: { userId } });
        await db.integration.deleteMany({ where: { userId } });
        await db.agentWorkspace.deleteMany({ where: { userId } });
        // Their stored chat files too.
        await bullmq.add(deleteFilesJob, { prefix: userFilesPrefix(userId) });
        if (workspace) {
          await bullmq.add(deleteWorkspaceJob, {
            tenantId: workspace.tenantId,
          });
        }
        for (const bot of bots) {
          await bullmq.add(deleteBotAgentJob, { agentId: bot.cencoriAgentId });
        }
      },
      profileImage: (address) =>
        nodeEnv === 'test'
          ? Promise.resolve(
              buildDicebearUrl(address, DEFAULT_DICEBEAR_STYLE, '200'),
            )
          : gravatar.profileImage(address),
    });
    this.handler = toNodeHandler(this.auth);
  }

  // The signed-in user and session for a request, or null.
  getSession(headers: IncomingHttpHeaders): Promise<AuthSession | null> {
    return this.auth.api.getSession({ headers: fromNodeHeaders(headers) });
  }

  // Built once at startup so the API docs can merge it in synchronously.
  async onModuleInit(): Promise<void> {
    if (this.config.get<boolean>('SWAGGER_ENABLED')) {
      this.openApi = (await this.auth.api.generateOpenAPISchema()) as Record<
        string,
        unknown
      >;
    }
  }

  // Better Auth's own routes as an OpenAPI document, for the API docs.
  openApiDocument(): Record<string, unknown> | undefined {
    return this.openApi;
  }

  // Production always has a secret (the config check requires it). Elsewhere a
  // missing secret gets a random one, so sessions end when the server restarts.
  private secret(nodeEnv: string): string {
    const secret = this.config.get<string>('BETTER_AUTH_SECRET');
    if (secret) return secret;

    if (nodeEnv !== 'test') {
      this.logger.warn(
        'BETTER_AUTH_SECRET is not set. Using a random secret, so sessions end when the server restarts.',
      );
    }
    return randomBytes(32).toString('base64');
  }
}
