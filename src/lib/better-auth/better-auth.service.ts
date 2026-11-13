import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailTemplateId } from '@better-auth/infra';
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
import { HashService } from '@/lib/hash/hash.service.js';
import { EmailOutboxService } from '@/lib/email/email-outbox.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

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
  // Tests only: the last email "sent" to each address.
  private readonly testEmails = new Map<string, Record<string, string>>();
  // Express handler for every Better Auth route.
  readonly handler: ReturnType<typeof toNodeHandler>;
  private readonly logger = new Logger(BetterAuthService.name);
  private readonly production: boolean;

  constructor(
    private readonly config: ConfigService,
    prisma: PrismaService,
    hasher: HashService,
    private readonly emailOutbox: EmailOutboxService,
  ) {
    const nodeEnv = config.getOrThrow<string>('NODE_ENV');
    this.production = nodeEnv === 'production';
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
      sendEmail: (template, to, variables) =>
        this.sendEmail(template, to, variables),
      passwordHasher: hasher,
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

  // Tests only: the variables of the last email to an address (e.g. otpCode).
  lastTestEmail(to: string): Record<string, string> | undefined {
    return this.testEmails.get(to);
  }

  // Better Auth's own routes as an OpenAPI document, for the API docs.
  openApiDocument(): Record<string, unknown> | undefined {
    return this.openApi;
  }

  // Emails go through Better Auth Infrastructure. Without its API key
  // (development only), the message is logged so you can still sign in.
  private async sendEmail(
    template: EmailTemplateId,
    to: string,
    variables: Record<string, string>,
  ): Promise<void> {
    // Tests never send email. They read the last message here instead.
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.testEmails.set(to, variables);
      return;
    }

    const apiKey = this.config.get<string>('BETTER_AUTH_API_KEY');
    if (!apiKey) {
      if (!this.production) {
        this.logger.warn(
          `Email not sent (no BETTER_AUTH_API_KEY). Template: ${template}.`,
        );
      }
      return;
    }
    await this.emailOutbox.enqueue(template, to, variables);
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
