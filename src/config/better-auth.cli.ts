// Only for `bun run auth:generate`, which writes Better Auth's models into
// prisma/schema.prisma. The running app builds its own instance in
// lib/better-auth/better-auth.service.ts.
import { betterAuth } from 'better-auth';
import { baseAuthOptions } from './better-auth.js';

export const auth = betterAuth(baseAuthOptions);
