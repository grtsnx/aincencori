import { z } from 'zod';

const environments = ['development', 'production', 'test'] as const;

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

// A comma-separated list in .env; empty means none.
function commaList(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(environments).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    PLATFORM_NAME: z.string().trim().min(1).default('Agentic'),
    CORS_ORIGINS: z.unknown().optional(),
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
    RECAPTCHA_SECRET_KEY: optionalString(),
    PASSKEY_RP_ID: optionalString().pipe(
      z
        .string()
        .regex(/^[a-z0-9.-]+$/i, {
          error: 'PASSKEY_RP_ID must be a domain name, such as example.com',
        })
        .optional(),
    ),
    MCP_RESOURCE_URL: optionalString().pipe(z.url().optional()),
    AUTH_IP_HEADERS: optionalString(),
    AUTH_TRUSTED_PROXIES: optionalString(),
    AUTH_COOKIE_DOMAIN: optionalString().pipe(
      z
        .string()
        .regex(/^[a-z0-9.-]+$/i, {
          error:
            'AUTH_COOKIE_DOMAIN must be a domain name, such as example.com',
        })
        .optional(),
    ),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'production') {
      for (const key of [
        'DATABASE_URL',
        'BETTER_AUTH_SECRET',
        'BETTER_AUTH_URL',
        'APP_URL',
        // Sends the sign-in codes; without it nobody can sign in with email.
        'BETTER_AUTH_API_KEY',
      ] as const) {
        if (!environment[key]) {
          context.addIssue({
            code: 'custom',
            message: `${key} is required in production`,
            path: [key],
          });
        }
      }
    }

    if (!environment.GOOGLE_CLIENT_ID !== !environment.GOOGLE_CLIENT_SECRET) {
      context.addIssue({
        code: 'custom',
        message:
          'Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
        path: ['GOOGLE_CLIENT_ID'],
      });
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
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL: string;
  AUTH_COOKIE_DOMAIN?: string;
  APP_URL: string;
  BETTER_AUTH_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RECAPTCHA_SECRET_KEY?: string;
  PASSKEY_RP_ID: string;
  MCP_RESOURCE_URL: string;
  AUTH_IP_HEADERS: string[];
  AUTH_TRUSTED_PROXIES: string[];
}

export function validateEnvironment(
  values: Record<string, unknown>,
): Environment {
  const parsed = environmentSchema.parse(values);
  const origins = corsOrigins(parsed.CORS_ORIGINS);
  const betterAuthUrl =
    parsed.BETTER_AUTH_URL ?? `http://localhost:${parsed.PORT}`;
  // The frontend. Defaults to the first CORS origin in development.
  const appUrl = parsed.APP_URL ?? origins[0] ?? 'http://localhost:3001';
  return {
    ...parsed,
    CORS_ORIGINS: origins,
    OBSERVE_ENABLED: parsed.OBSERVE_ENABLED ?? false,
    SWAGGER_ENABLED: parsed.SWAGGER_ENABLED ?? parsed.NODE_ENV !== 'production',
    BETTER_AUTH_URL: betterAuthUrl,
    APP_URL: appUrl,
    PASSKEY_RP_ID: parsed.PASSKEY_RP_ID ?? new URL(appUrl).hostname,
    MCP_RESOURCE_URL: parsed.MCP_RESOURCE_URL ?? `${betterAuthUrl}/mcp`,
    AUTH_IP_HEADERS: commaList(parsed.AUTH_IP_HEADERS),
    AUTH_TRUSTED_PROXIES: commaList(parsed.AUTH_TRUSTED_PROXIES),
  };
}
