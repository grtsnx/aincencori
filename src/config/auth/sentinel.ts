import type { SentinelOptions } from '@better-auth/infra';

// Sentinel (Better Auth Infrastructure): abuse protection on sign-in and
// sign-up. "challenge" makes the browser solve a small proof-of-work first, so
// the frontend must add sentinelClient() from '@better-auth/infra/client'.
export const sentinelSecurity: SentinelOptions['security'] = {
  // Automated clients and known bad IPs.
  botBlocking: { action: 'challenge' },
  suspiciousIpBlocking: { action: 'challenge' },
  // Many sign-in attempts across accounts from one source.
  credentialStuffing: { enabled: true, action: 'challenge' },
  // Sign-ins from two places too far apart to travel between in time.
  impossibleTravel: { enabled: true, action: 'challenge' },
  // Too many sign-ins or sign-ups from one IP or visitor.
  velocity: { enabled: true, action: 'challenge' },
  // Many accounts from one visitor: logged for now, not blocked.
  freeTrialAbuse: { enabled: true, action: 'log' },
  // Accounts that wake up after 60 quiet days: logged.
  staleUsers: { enabled: true, staleDays: 60, action: 'log' },
  // Extra email checks. Harmony already normalizes emails, so Sentinel doesn't.
  emailValidation: { enabled: true, strictness: 'medium', action: 'block' },
  emailNormalization: { enabled: false },
  // No passwords here (email codes, OAuth, passkeys), so nothing to check.
  compromisedPassword: { enabled: false },
};
