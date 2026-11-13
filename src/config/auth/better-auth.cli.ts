// Only for `bun run auth:generate`, which writes Better Auth's models into
// prisma/schema.prisma. The running app builds its own instance in
// lib/better-auth/better-auth.service.ts. Every optional feature is switched on
// here so the schema includes all of their tables and fields.
import { betterAuth } from 'better-auth';
import { createAuthOptions } from './better-auth.js';

export const auth = betterAuth(
  createAuthOptions({
    appName: 'Agentic',
    baseURL: 'http://localhost:3000',
    appURL: 'http://localhost:3001',
    secret: 'schema-generation-only-secret-0000000000',
    trustedOrigins: [],
    dashApiKey: 'schema-generation-only',
    google: { clientId: 'schema', clientSecret: 'schema' },
    recaptchaSecretKey: 'schema',
    passkeyRpID: 'localhost',
    mcpResource: 'http://localhost:3000/mcp',
    ipAddressHeaders: [],
    trustedProxies: [],
    testing: false,
    sendEmail: async () => {},
  }),
);
