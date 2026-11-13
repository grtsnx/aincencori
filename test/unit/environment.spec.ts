import { describe, expect, it } from 'vitest';
import {
  clientIpHeaders,
  sharedParentDomain,
  validateEnvironment,
} from '@/config/environment.js';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
  REDIS_URL: 'rediss://default:pass@redis.example.com:6379',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'https://api.example.com',
  APP_URL: 'https://app.example.com',
  MAIL_FROM: 'Agentic <no-reply@example.com>',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'mailer',
  SMTP_PASSWORD: 'secret',
  CORS_ORIGINS: 'https://app.example.com',
  AUTH_IP_HEADERS: 'x-vercel-forwarded-for',
};

describe('validateEnvironment', () => {
  it('uses secure, stateless defaults', () => {
    expect(validateEnvironment({})).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      PLATFORM_NAME: 'Agentic',
      CORS_ORIGINS: [],
      OBSERVE_ENABLED: false,
      SWAGGER_ENABLED: true,
    });
  });

  it('normalizes and deduplicates CORS origins', () => {
    const environment = validateEnvironment({
      CORS_ORIGINS:
        'https://app.example.com, https://admin.example.com,https://app.example.com',
    });

    expect(environment.CORS_ORIGINS).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('rejects wildcard and path-based CORS origins', () => {
    expect(() => validateEnvironment({ CORS_ORIGINS: '*' })).toThrow(
      /CORS_ORIGINS/,
    );
    expect(() =>
      validateEnvironment({ CORS_ORIGINS: 'https://example.com/app' }),
    ).toThrow(/CORS_ORIGINS/);
  });

  it('uses the local Valkey for jobs unless REDIS_URL is set', () => {
    expect(validateEnvironment({}).REDIS_URL).toBe('redis://localhost:6380');
    expect(() =>
      validateEnvironment({ REDIS_URL: 'http://localhost:6379' }),
    ).toThrow(/REDIS_URL/);
  });

  it('disables Swagger by default in production', () => {
    expect(validateEnvironment(production).SWAGGER_ENABLED).toBe(false);
  });

  it('requires the database and Better Auth settings in production', () => {
    for (const key of [
      'DATABASE_URL',
      'REDIS_URL',
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'APP_URL',
      'MAIL_FROM',
    ] as const) {
      expect(() => validateEnvironment({ ...production, [key]: '' })).toThrow(
        new RegExp(`${key} is required in production`),
      );
    }
  });

  it('requires HTTPS for production auth and frontend origins', () => {
    expect(() =>
      validateEnvironment({
        ...production,
        BETTER_AUTH_URL: 'http://api.example.com',
      }),
    ).toThrow(/BETTER_AUTH_URL must use HTTPS in production/);
    expect(() =>
      validateEnvironment({ ...production, APP_URL: 'http://app.example.com' }),
    ).toThrow(/APP_URL must use HTTPS in production/);
    expect(() =>
      validateEnvironment({
        ...production,
        CORS_ORIGINS: 'http://app.example.com',
      }),
    ).toThrow(/CORS_ORIGINS must use HTTPS in production/);
  });

  it('requires the distinct frontend origin in production CORS settings', () => {
    expect(() =>
      validateEnvironment({
        ...production,
        CORS_ORIGINS: 'https://admin.example.com',
      }),
    ).toThrow(/APP_URL must be included in CORS_ORIGINS/);
  });

  it('requires explicit trusted client IP configuration in production', () => {
    expect(() => {
      const { AUTH_IP_HEADERS: _ignored, ...withoutHeaders } = production;
      validateEnvironment(withoutHeaders);
    }).toThrow(/AUTH_IP_HEADERS is required in production/);

    expect(() =>
      validateEnvironment({
        ...production,
        AUTH_IP_HEADERS: 'x-forwarded-for',
      }),
    ).toThrow(
      /AUTH_TRUSTED_PROXIES is required when x-forwarded-for is trusted/,
    );

    expect(() =>
      validateEnvironment({
        ...production,
        AUTH_IP_HEADERS: 'x-forwarded-for',
        AUTH_TRUSTED_PROXIES: 'not-a-cidr',
      }),
    ).toThrow(/AUTH_TRUSTED_PROXIES contains an invalid IP or CIDR/);
  });

  it('rejects multiple client IP headers to prevent spoofable fallbacks', () => {
    expect(() =>
      validateEnvironment({
        ...production,
        AUTH_IP_HEADERS: 'x-vercel-forwarded-for,cf-connecting-ip',
      }),
    ).toThrow(/AUTH_IP_HEADERS must contain exactly one trusted header/);
  });

  it('returns the explicitly trusted client IP headers and proxy CIDRs', () => {
    expect(
      validateEnvironment({
        ...production,
        AUTH_IP_HEADERS: 'x-forwarded-for',
        AUTH_TRUSTED_PROXIES: '10.0.0.0/8,2001:db8::/32',
      }),
    ).toMatchObject({
      AUTH_IP_HEADERS: ['x-forwarded-for'],
      AUTH_TRUSTED_PROXIES: ['10.0.0.0/8', '2001:db8::/32'],
    });
  });

  it('lets development run without database or auth settings', () => {
    const environment = validateEnvironment({
      PORT: '4000',
      DATABASE_URL: '',
      BETTER_AUTH_SECRET: '',
    });

    expect(environment.DATABASE_URL).toBeUndefined();
    expect(environment.BETTER_AUTH_SECRET).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(environment.BETTER_AUTH_URL).toBe('http://localhost:4000');
  });

  it('reuses the generated development secret across environment reads', () => {
    const first = validateEnvironment({}).BETTER_AUTH_SECRET;
    const second = validateEnvironment({}).BETTER_AUTH_SECRET;

    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it('rejects weak secrets and malformed auth settings', () => {
    expect(() => validateEnvironment({ BETTER_AUTH_SECRET: 'short' })).toThrow(
      /BETTER_AUTH_SECRET must be at least 32 characters/,
    );
    expect(() =>
      validateEnvironment({ BETTER_AUTH_URL: 'https://api.example.com/v1' }),
    ).toThrow(/BETTER_AUTH_URL/);
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'mysql://localhost/app' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects invalid ports and booleans', () => {
    expect(() => validateEnvironment({ PORT: '0' })).toThrow(/PORT/);
    expect(() => validateEnvironment({ OBSERVE_ENABLED: 'sometimes' })).toThrow(
      /OBSERVE_ENABLED/,
    );
  });

  it('requires complete observability credentials when enabled', () => {
    expect(() => validateEnvironment({ OBSERVE_ENABLED: 'true' })).toThrow(
      /OBSERVE_APP_KEY/,
    );

    expect(
      validateEnvironment({
        OBSERVE_ENABLED: 'true',
        OBSERVE_APP_KEY: 'key',
        OBSERVE_APP_SECRET: 'secret',
        OBSERVE_SERVICE_ID: 'service',
      }).OBSERVE_ENABLED,
    ).toBe(true);
  });

  it('requires both ID and secret for each sign-in provider', () => {
    for (const provider of ['GOOGLE', 'GITHUB', 'LINKEDIN']) {
      expect(() =>
        validateEnvironment({ [`${provider}_CLIENT_ID`]: 'id' }),
      ).toThrow(
        new RegExp(`${provider}_CLIENT_ID and ${provider}_CLIENT_SECRET`),
      );
    }
    expect(
      validateEnvironment({
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 'secret',
      }).GITHUB_CLIENT_ID,
    ).toBe('id');
  });

  it('shares the login cookie across subdomains automatically', () => {
    const shared = validateEnvironment({
      APP_URL: 'https://app.example.com',
      BETTER_AUTH_URL: 'https://api.example.com',
    });
    expect(shared).toMatchObject({
      AUTH_COOKIE_DOMAIN: 'example.com',
      PASSKEY_RP_ID: 'example.com',
    });

    const local = validateEnvironment({
      APP_URL: 'http://localhost:3001',
      BETTER_AUTH_URL: 'http://localhost:3000',
    });
    expect(local.AUTH_COOKIE_DOMAIN).toBeUndefined();
    expect(local.PASSKEY_RP_ID).toBe('localhost');
  });

  it('derives frontend, passkey and MCP defaults', () => {
    expect(
      validateEnvironment({
        CORS_ORIGINS: 'https://app.example.com',
        BETTER_AUTH_URL: 'https://api.example.com',
      }),
    ).toMatchObject({
      APP_URL: 'https://app.example.com',
      PASSKEY_RP_ID: 'example.com',
      MCP_RESOURCE_URL: 'https://api.example.com/mcp',
    });
  });
});

describe('sharedParentDomain', () => {
  it('finds the parent two sites share', () => {
    expect(
      sharedParentDomain('https://app.example.com', 'https://api.example.com'),
    ).toBe('example.com');
    expect(
      sharedParentDomain('https://example.com', 'https://api.example.com'),
    ).toBe('example.com');
  });

  it('returns nothing when there is no shared parent to set', () => {
    expect(
      sharedParentDomain('https://app.example.com', 'https://app.example.com'),
    ).toBeUndefined();
    expect(
      sharedParentDomain('https://app.example.com', 'https://api.other.org'),
    ).toBeUndefined();
    expect(
      sharedParentDomain('http://localhost:3001', 'http://localhost:3000'),
    ).toBeUndefined();
    expect(
      sharedParentDomain('http://127.0.0.1:3001', 'http://127.0.0.2:3000'),
    ).toBeUndefined();
  });
});

describe('clientIpHeaders', () => {
  it('uses only the detected hosting platform header', () => {
    expect(clientIpHeaders({})).toEqual(['x-forwarded-for']);
    expect(clientIpHeaders({ VERCEL: '1' })).toEqual([
      'x-vercel-forwarded-for',
    ]);
    expect(clientIpHeaders({ FLY_APP_NAME: 'api' })).toEqual(['fly-client-ip']);
    expect(clientIpHeaders({ AWS_EXECUTION_ENV: 'AWS_ECS_FARGATE' })).toEqual([
      'x-forwarded-for',
    ]);
  });
});

describe('email settings', () => {
  it('needs Resend or SMTP in production', () => {
    expect(() => validateEnvironment({ ...production, SMTP_HOST: '' })).toThrow(
      /RESEND_API_KEY or SMTP_HOST/,
    );
    expect(
      validateEnvironment({
        ...production,
        SMTP_HOST: '',
        SMTP_USER: '',
        SMTP_PASSWORD: '',
        RESEND_API_KEY: 're_x',
      }).RESEND_API_KEY,
    ).toBe('re_x');
  });

  it('uses Mailpit locally and port 587 for a real SMTP host', () => {
    expect(validateEnvironment({})).toMatchObject({
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      MAIL_FROM: 'Agentic <no-reply@localhost>',
    });
    expect(
      validateEnvironment({ SMTP_HOST: 'smtp.example.com' }),
    ).toMatchObject({ SMTP_PORT: 587, SMTP_SECURE: false });
    expect(
      validateEnvironment({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465' }),
    ).toMatchObject({ SMTP_PORT: 465, SMTP_SECURE: true });
  });

  it('needs both SMTP user and password, or neither', () => {
    expect(() => validateEnvironment({ SMTP_USER: 'mailer' })).toThrow(
      /SMTP_USER and SMTP_PASSWORD/,
    );
    expect(() => validateEnvironment({ SMTP_PORT: '99999' })).toThrow(
      /SMTP_PORT/,
    );
  });
});
