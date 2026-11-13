import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '@/config/environment.js';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'https://api.example.com',
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

  it('disables Swagger by default in production', () => {
    expect(validateEnvironment(production).SWAGGER_ENABLED).toBe(false);
  });

  it('requires the database and Better Auth settings in production', () => {
    for (const key of [
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
    ] as const) {
      expect(() => validateEnvironment({ ...production, [key]: '' })).toThrow(
        new RegExp(`${key} is required in production`),
      );
    }
  });

  it('lets development run without database or auth settings', () => {
    const environment = validateEnvironment({
      PORT: '4000',
      DATABASE_URL: '',
      BETTER_AUTH_SECRET: '',
    });

    expect(environment.DATABASE_URL).toBeUndefined();
    expect(environment.BETTER_AUTH_SECRET).toBeUndefined();
    expect(environment.BETTER_AUTH_URL).toBe('http://localhost:4000');
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
    expect(() =>
      validateEnvironment({ AUTH_COOKIE_DOMAIN: 'https://example.com' }),
    ).toThrow(/AUTH_COOKIE_DOMAIN/);
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
});
