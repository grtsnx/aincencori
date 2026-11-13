import type { BetterAuthOptions } from 'better-auth';

// Better Auth serves every auth route under this path.
export const authBasePath = '/api/auth';

// Options shared by the running app (lib/better-auth) and the schema generator
// (better-auth.cli.ts). Change them here, then run `bun run auth:generate` and
// `bun run db:migrate` so the database matches.
export const baseAuthOptions = {
  basePath: authBasePath,
  emailAndPassword: { enabled: true },
  telemetry: { enabled: false },
} satisfies BetterAuthOptions;
