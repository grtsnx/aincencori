import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const environments = ['development', 'production', 'test'] as const;
const ephemeralAuthSecret = randomBytes(32).toString('base64');

const booleanValue = (name: string) =>
  z.preprocess(
    (value) => {
      if (typeof value === 'boolean') return value;
      if (typeof value !== 'string') return value;

      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
      if (['false', '0', 'off', 'no'].includes(normalized)) return false;
      return value;
    },
    z.boolean({ error: `${name} must be a boolean` }),
  );

function corsOrigins(value: unknown): string[] {
  if (value === undefined || value === '') return [];
  const values = Array.isArray(value) ? value : String(value).split(',');
  const origins = values
    .map(String)
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`CORS_ORIGINS contains an invalid origin: ${origin}`);
    }

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      url.username !== '' ||
      url.password !== ''
    ) {
      throw new Error(
        `CORS_ORIGINS must contain exact http(s) origins without paths: ${origin}`,
      );
    }
  }

  return [...new Set(origins)];
}

// An empty value in .env (KEY=) counts as not set.
const optionalString = () =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().optional(),
  );

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}

const optionalOrigin = (name: string, example: string) =>
  optionalString().pipe(
    z
      .string()
      .refine(isHttpOrigin, {
        error: `${name} must be an http(s) origin without a path, such as ${example}`,
      })
      .optional(),
  );

// The parent domain the frontend and API share, so they can share the session
// cookie: app.example.com + api.example.com -> example.com. None for the same
// host, localhost or IP addresses, where cookies already work.
export function sharedParentDomain(a: string, b: string): string | undefined {
  const hosts = [new URL(a).hostname, new URL(b).hostname];
  if (hosts[0] === hosts[1]) return undefined;
  if (hosts.some((host) => host === 'localhost' || /^[\d.:[\]]+$/.test(host))) {
    return undefined;
  }
  const [first, second] = hosts.map((host) => host.split('.').reverse());
  const shared: string[] = [];
  for (let i = 0; i < Math.min(first.length, second.length); i++) {
    if (first[i] !== second[i]) break;
    shared.push(first[i]);
  }
  return shared.length >= 2 ? shared.reverse().join('.') : undefined;
}

// Headers that carry the visitor's real IP behind a proxy or CDN, used to rate
// limit each person separately. Better Auth uses the first one present, so the
// header of the platform we run on goes first: a header the platform does not
// set could be sent by anyone with a fake IP.
const ipHeaders = [
  'cf-connecting-ip', // Cloudflare
  'true-client-ip', // Akamai, Cloudflare Enterprise
  'x-vercel-forwarded-for', // Vercel
  'fly-client-ip', // Fly.io
  'fastly-client-ip', // Fastly
  'x-real-ip', // nginx and many hosts
  'x-forwarded-for', // Amazon load balancers and API Gateway; the usual default
];

const supportedIpHeaders = new Set(ipHeaders);

function splitList(value: unknown): string[] {
  if (value === undefined || value === '') return [];
  const values = Array.isArray(value) ? value : String(value).split(',');
  return [
    ...new Set(
      values
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function isIpOrCidr(value: string): boolean {
  const parts = value.split('/');
  if (parts.length > 2 || !parts[0]) return false;
  const version = isIP(parts[0]);
  if (version === 0) return false;
  if (parts.length === 1) return true;
  const prefix = parts[1];
  if (!prefix || !/^\d+$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}

export function clientIpHeaders(values: Record<string, unknown>): string[] {
  if (values.VERCEL) return ['x-vercel-forwarded-for'];
  if (values.FLY_APP_NAME) return ['fly-client-ip'];
  return ['x-forwarded-for'];
}

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(environments).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    PLATFORM_NAME: z.string().trim().min(1).default('Agentic'),
    CORS_ORIGINS: z.unknown().optional(),
    AUTH_IP_HEADERS: optionalString(),
    AUTH_TRUSTED_PROXIES: optionalString(),
    OBSERVE_ENABLED: booleanValue('OBSERVE_ENABLED').optional(),
    OBSERVE_APP_KEY: z.string().trim().optional(),
    OBSERVE_APP_SECRET: z.string().trim().optional(),
    OBSERVE_SERVICE_ID: z.string().trim().optional(),
    SWAGGER_ENABLED: booleanValue('SWAGGER_ENABLED').optional(),
    DATABASE_URL: optionalString().pipe(
      z
        .string()
        .regex(/^postgres(ql)?:\/\//, {
          error: 'DATABASE_URL must be a postgres:// or postgresql:// URL',
        })
        .optional(),
    ),
    REDIS_URL: optionalString().pipe(
      z
        .string()
        .regex(/^rediss?:\/\//, {
          error: 'REDIS_URL must be a redis:// or rediss:// URL',
        })
        .optional(),
    ),
    BETTER_AUTH_SECRET: optionalString().pipe(
      z
        .string()
        .min(32, { error: 'BETTER_AUTH_SECRET must be at least 32 characters' })
        .optional(),
    ),
    BETTER_AUTH_URL: optionalOrigin(
      'BETTER_AUTH_URL',
      'https://api.example.com',
    ),
    APP_URL: optionalOrigin('APP_URL', 'https://app.example.com'),
    BETTER_AUTH_API_KEY: optionalString(),
    GOOGLE_CLIENT_ID: optionalString(),
    GOOGLE_CLIENT_SECRET: optionalString(),
    GITHUB_CLIENT_ID: optionalString(),
    GITHUB_CLIENT_SECRET: optionalString(),
    LINKEDIN_CLIENT_ID: optionalString(),
    LINKEDIN_CLIENT_SECRET: optionalString(),
    RECAPTCHA_SECRET_KEY: optionalString(),
    RESEND_API_KEY: optionalString(),
    CENCORI_API_KEY: optionalString(),
    CENCORI_AGENT_ID: optionalString(),
    AGENT_MCP_URL: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.url().optional(),
    ),
    SMTP_HOST: optionalString(),
    SMTP_PORT: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.coerce.number().int().min(1).max(65_535).optional(),
    ),
    SMTP_SECURE: booleanValue('SMTP_SECURE').optional(),
    SMTP_USER: optionalString(),
    SMTP_PASSWORD: optionalString(),
    MAIL_FROM: optionalString(),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'production') {
      for (const key of [
        'DATABASE_URL',
        // Background jobs and routines.
        'REDIS_URL',
        'BETTER_AUTH_SECRET',
        'BETTER_AUTH_URL',
        'APP_URL',
        // The sender address for sign-in codes and invites.
        'MAIL_FROM',
      ] as const) {
        if (!environment[key]) {
          context.addIssue({
            code: 'custom',
            message: `${key} is required in production`,
            path: [key],
          });
        }
      }

      // Sign-in codes need a way out: Resend or an SMTP server.
      if (!environment.RESEND_API_KEY && !environment.SMTP_HOST) {
        context.addIssue({
          code: 'custom',
          message: 'Set RESEND_API_KEY or SMTP_HOST in production',
          path: ['SMTP_HOST'],
        });
      }

      if (!environment.AUTH_IP_HEADERS) {
        context.addIssue({
          code: 'custom',
          message: 'AUTH_IP_HEADERS is required in production',
          path: ['AUTH_IP_HEADERS'],
        });
      }

      if (
        splitList(environment.AUTH_IP_HEADERS).includes('x-forwarded-for') &&
        !environment.AUTH_TRUSTED_PROXIES
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'AUTH_TRUSTED_PROXIES is required when x-forwarded-for is trusted',
          path: ['AUTH_TRUSTED_PROXIES'],
        });
      }
    }

    // An SMTP login needs both its user and password, or neither.
    if (!environment.SMTP_USER !== !environment.SMTP_PASSWORD) {
      context.addIssue({
        code: 'custom',
        message: 'Set both SMTP_USER and SMTP_PASSWORD, or neither',
        path: ['SMTP_USER'],
      });
    }

    // Each sign-in provider needs both its ID and secret, or neither.
    for (const provider of ['GOOGLE', 'GITHUB', 'LINKEDIN'] as const) {
      const id = environment[`${provider}_CLIENT_ID`];
      const secret = environment[`${provider}_CLIENT_SECRET`];
      if (!id !== !secret) {
        context.addIssue({
          code: 'custom',
          message: `Set both ${provider}_CLIENT_ID and ${provider}_CLIENT_SECRET, or neither`,
          path: [`${provider}_CLIENT_ID`],
        });
      }
    }

    if (!environment.OBSERVE_ENABLED) return;

    for (const key of [
      'OBSERVE_APP_KEY',
      'OBSERVE_APP_SECRET',
      'OBSERVE_SERVICE_ID',
    ] as const) {
      if (!environment[key]) {
        context.addIssue({
          code: 'custom',
          message: `${key} is required when OBSERVE_ENABLED is true`,
          path: [key],
        });
      }
    }
  });

export interface Environment {
  NODE_ENV: (typeof environments)[number];
  PORT: number;
  PLATFORM_NAME: string;
  CORS_ORIGINS: string[];
  OBSERVE_ENABLED: boolean;
  OBSERVE_APP_KEY?: string;
  OBSERVE_APP_SECRET?: string;
  OBSERVE_SERVICE_ID?: string;
  SWAGGER_ENABLED: boolean;
  DATABASE_URL?: string;
  REDIS_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  AUTH_COOKIE_DOMAIN?: string;
  APP_URL: string;
  BETTER_AUTH_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  RECAPTCHA_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  CENCORI_API_KEY?: string;
  CENCORI_AGENT_ID?: string;
  AGENT_MCP_URL?: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  MAIL_FROM: string;
  // Worked out, not set in .env.
  AUTH_IP_HEADERS: string[];
  AUTH_TRUSTED_PROXIES: string[];
  PASSKEY_RP_ID: string;
  MCP_RESOURCE_URL: string;
}

export function validateEnvironment(
  values: Record<string, unknown>,
): Environment {
  const parsed = environmentSchema.parse(values);
  const origins = corsOrigins(parsed.CORS_ORIGINS);
  const configuredIpHeaders = splitList(parsed.AUTH_IP_HEADERS).map((header) =>
    header.toLowerCase(),
  );
  const trustedProxies = splitList(parsed.AUTH_TRUSTED_PROXIES);

  if (configuredIpHeaders.some((header) => !supportedIpHeaders.has(header))) {
    throw new Error(
      `AUTH_IP_HEADERS may contain only these headers: ${[...ipHeaders].join(', ')}`,
    );
  }
  if (parsed.NODE_ENV === 'production' && configuredIpHeaders.length !== 1) {
    throw new Error('AUTH_IP_HEADERS must contain exactly one trusted header');
  }
  if (trustedProxies.some((proxy) => !isIpOrCidr(proxy))) {
    throw new Error('AUTH_TRUSTED_PROXIES contains an invalid IP or CIDR');
  }

  const betterAuthUrl =
    parsed.BETTER_AUTH_URL ?? `http://localhost:${parsed.PORT}`;
  // The frontend. Defaults to the first CORS origin in development.
  const appUrl = parsed.APP_URL ?? origins[0] ?? 'http://localhost:3001';

  if (parsed.NODE_ENV === 'production') {
    const productionOrigins = [
      ['BETTER_AUTH_URL', betterAuthUrl],
      ['APP_URL', appUrl],
      ...origins.map((origin) => ['CORS_ORIGINS', origin] as const),
    ] as const;
    for (const [name, origin] of productionOrigins) {
      if (new URL(origin).protocol !== 'https:') {
        throw new Error(`${name} must use HTTPS in production`);
      }
    }
    if (betterAuthUrl !== appUrl && !origins.includes(appUrl)) {
      throw new Error('APP_URL must be included in CORS_ORIGINS');
    }
    if (
      configuredIpHeaders.includes('x-forwarded-for') &&
      trustedProxies.length === 0
    ) {
      throw new Error(
        'AUTH_TRUSTED_PROXIES is required when x-forwarded-for is trusted',
      );
    }
  }

  const cookieDomain = sharedParentDomain(appUrl, betterAuthUrl);
  const smtpPort = parsed.SMTP_PORT ?? (parsed.SMTP_HOST ? 587 : 1025);
  return {
    ...parsed,
    BETTER_AUTH_SECRET: parsed.BETTER_AUTH_SECRET ?? ephemeralAuthSecret,
    CORS_ORIGINS: origins,
    OBSERVE_ENABLED: parsed.OBSERVE_ENABLED ?? false,
    SWAGGER_ENABLED: parsed.SWAGGER_ENABLED ?? parsed.NODE_ENV !== 'production',
    BETTER_AUTH_URL: betterAuthUrl,
    APP_URL: appUrl,
    AUTH_IP_HEADERS: configuredIpHeaders.length
      ? configuredIpHeaders
      : clientIpHeaders(values),
    AUTH_TRUSTED_PROXIES: trustedProxies,
    AUTH_COOKIE_DOMAIN: cookieDomain,
    // Passkeys belong to the shared parent domain when there is one.
    PASSKEY_RP_ID: cookieDomain ?? new URL(appUrl).hostname,
    MCP_RESOURCE_URL: `${betterAuthUrl}/mcp`,
    // Locally: the Valkey container from compose.yaml.
    REDIS_URL: parsed.REDIS_URL ?? 'redis://localhost:6380',
    // Locally: the Mailpit container from compose.yaml (inbox at :8025).
    SMTP_HOST: parsed.SMTP_HOST ?? 'localhost',
    SMTP_PORT: smtpPort,
    // Port 465 uses TLS from the start; 587 and 25 upgrade with STARTTLS.
    SMTP_SECURE: parsed.SMTP_SECURE ?? smtpPort === 465,
    MAIL_FROM:
      parsed.MAIL_FROM ?? `${parsed.PLATFORM_NAME} <no-reply@localhost>`,
  };
}
