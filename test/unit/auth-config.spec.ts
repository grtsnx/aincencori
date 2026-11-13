import { describe, expect, it } from 'vitest';
import { createAuthOptions, type AuthSettings } from '@/config/auth/better-auth.js';
import { symmetricDecrypt } from 'better-auth/crypto';
import { encryptOAuthToken } from '@/lib/better-auth/oauth-token-encryption.js';

const settings: AuthSettings = {
  appName: 'Agentic',
  baseURL: 'https://api.example.com',
  appURL: 'https://app.example.com',
  secret: 'test-secret-that-is-long-enough-for-this-suite',
  trustedOrigins: [],
  oauth: {},
  passkeyRpID: 'example.com',
  mcpResource: 'https://api.example.com/mcp',
  ipAddressHeaders: ['x-forwarded-for'],
  trustedProxies: ['10.0.0.0/8'],
  trustProxy: true,
  testing: true,
  sendEmail: async () => {},
  passwordHasher: {
    hash: async (value) => value,
    verify: async () => false,
  },
};

describe('createAuthOptions', () => {
  it('encrypts OAuth tokens and trusts only the configured frontend origin', () => {
    const options = createAuthOptions(settings);

    expect(options.account).toMatchObject({ encryptOAuthTokens: true });
    expect(options.trustedOrigins).toEqual(['https://app.example.com']);
    expect(options.advanced?.ipAddress).toMatchObject({
      ipAddressHeaders: ['x-forwarded-for'],
      trustedProxies: ['10.0.0.0/8'],
    });

  it('encrypts plaintext OAuth tokens idempotently', async () => {
    const token = 'provider-refresh-token-value';
    const encrypted = await encryptOAuthToken(token, settings.secret);

    expect(encrypted).not.toBe(token);
    expect(
      await symmetricDecrypt({ key: settings.secret, data: encrypted! }),
    ).toBe(token);
    expect(await encryptOAuthToken(encrypted, settings.secret)).toBe(encrypted);
    expect(await encryptOAuthToken(null, settings.secret)).toBeNull();
  });
  });

});
