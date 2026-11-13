import { passkey } from '@better-auth/passkey';
import { emailHarmony } from 'better-auth-harmony';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { dash, sentinel } from '@better-auth/infra';
import { mcp } from '@better-auth/mcp';
import type { BetterAuthOptions } from 'better-auth';
import {
  admin,
  captcha,
  emailOTP,
  jwt,
  lastLoginMethod,
  multiSession,
  openAPI,
  organization,
  testUtils,
  twoFactor,
} from 'better-auth/plugins';
import { randomBytes } from 'node:crypto';
import type { EmailTemplate } from '@/config/email/templates.js';
import { organizationAc, organizationRoles } from './access.js';
import { agentAuthPlugin } from './agent.js';
import { sentinelSecurity } from './sentinel.js';

// Scopes OAuth and MCP apps may ask for (Better Auth's defaults).
const oauthScopes = ['openid', 'profile', 'email', 'offline_access'];

// Better Auth serves every auth route under this path.
// Versioned with the rest of the API. v2 gets its own when we start v2.
export const authBasePath = '/v1/auth';

// Sends one of the Better Auth dashboard's email templates.
export type AuthMailer = (
  template: EmailTemplate,
  to: string,
  variables: Record<string, string>,
) => Promise<void>;

export interface AuthSettings {
  appName: string;
  // This API's origin.
  baseURL: string;
  // The frontend's origin: sign-in, consent and invitation pages live there.
  appURL: string;
  secret: string;
  trustedOrigins: string[];
  cookieDomain?: string;
  // Better Auth Infrastructure: dashboard and email delivery.
  dashApiKey?: string;
  // OAuth sign-in. A provider is on when its ID and secret are set.
  oauth: Partial<
    Record<
      'google' | 'github' | 'linkedin',
      { clientId: string; clientSecret: string }
    >
  >;
  recaptchaSecretKey?: string;
  passkeyRpID: string;
  mcpResource: string;
  // Where to read the visitor's IP, in order (see config/environment.ts).
  ipAddressHeaders: string[];
  trustedProxies: string[];
  // True in production, where the API always sits behind a proxy.
  trustProxy: boolean;
  // Adds Better Auth's test helpers. Never true in production.
  testing: boolean;
  sendEmail: AuthMailer;
  // A profile picture for a new user without one (Gravatar, else DiceBear).
  profileImage: (email: string) => Promise<string>;
  // Fast shared storage (Redis). With it, sessions and rate limits are read
  // from Redis instead of Postgres on every request.
  secondaryStorage?: NonNullable<BetterAuthOptions['secondaryStorage']>;
  // Removes what we keep for a user (their chats) when the user is deleted.
  onUserDeleted?: (userId: string) => Promise<void>;
  // Argon2id, from lib/hash. Used for every password Better Auth stores.
  passwordHasher: {
    hash(value: string): Promise<string>;
    verify(hashed: string, value: string): Promise<boolean>;
  };
}

// Every option except the database. Used by the running app
// (lib/better-auth) and by the schema generator (better-auth.cli.ts).
// After changing it, run `bun run auth:generate` and `bun run db:migrate`.
export function createAuthOptions(settings: AuthSettings) {
  const send = (
    template: EmailTemplate,
    to: string,
    variables: Record<string, string>,
  ) =>
    settings.sendEmail(template, to, {
      appName: settings.appName,
      ...variables,
    });

  return {
    appName: settings.appName,
    basePath: authBasePath,
    baseURL: settings.baseURL,
    secret: settings.secret,
    trustedOrigins: [...new Set([...settings.trustedOrigins, settings.appURL])],
    telemetry: { enabled: false },

    // New users without a photo get one: their Gravatar if they have one,
    // otherwise an animated DiceBear "loops" avatar.
    databaseHooks: {
      user: {
        create: {
          before: async (user) =>
            user.image
              ? undefined
              : {
                  data: {
                    ...user,
                    image: await settings.profileImage(user.email),
                  },
                },
        },
        delete: {
          after: async (user) => {
            await settings.onUserDeleted?.(user.id);
          },
        },
      },
    },

    // Failed OAuth sign-ins (cancelled, bad callback) land on our frontend,
    // not Better Auth's development error page. The error is in the query.
    onAPIError: { errorURL: `${settings.appURL}/auth/error` },

    // Sign-in is email OTP, Google or passkey. No password sign-in. Any password
    // Better Auth still stores (for example set by an admin) is hashed with Argon2id.
    emailAndPassword: {
      enabled: false,
      password: {
        hash: (password: string) => settings.passwordHasher.hash(password),
        verify: ({ hash, password }: { hash: string; password: string }) =>
          settings.passwordHasher.verify(hash, password),
      },
    },
    socialProviders: {
      ...(settings.oauth.google && {
        google: { ...settings.oauth.google, prompt: 'select_account' as const },
      }),
      ...(settings.oauth.github && { github: settings.oauth.github }),
      ...(settings.oauth.linkedin && { linkedin: settings.oauth.linkedin }),
    },

    // An OAuth sign-in (Google, GitHub, LinkedIn) never joins an existing
    // account by matching email. The user signs in first (email OTP), then
    // links the provider with linkSocial().
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
      },
    },

    // Shared across instances, so limits hold when the API scales out.
    // With Redis: sessions are read from Redis (no database read per
    // request) and still saved in Postgres; rate limits count in Redis.
    ...(settings.secondaryStorage
      ? {
          secondaryStorage: settings.secondaryStorage,
          session: { storeSessionInDatabase: true },
          rateLimit: { storage: 'secondary-storage' as const },
        }
      : { rateLimit: { storage: 'database' as const } }),

    // MCP clients get tokens from /oauth2/token, not /token.
    disabledPaths: ['/token'],

    advanced: {
      // Fetch related rows (session + user, organization + members) in one
      // query instead of several. Prisma relations come from auth:generate.
      database: { joins: true },
      ...(settings.cookieDomain && {
        crossSubDomainCookies: {
          enabled: true,
          domain: settings.cookieDomain,
        },
      }),
      ipAddress: {
        ipAddressHeaders: settings.ipAddressHeaders,
        trustedProxies: settings.trustedProxies,
      },
    },

    plugins: [
      // Runs first and locally: blocks throwaway email domains and stores a
      // normalized copy (ada+x@gmail.com -> ada@gmail.com) so one inbox gets one
      // account. The email the user typed is kept as is.
      emailHarmony(),
      emailOTP({
        // Codes are stored hashed. Better Auth compares them by exact match, so
        // a salted hash like Argon2 cannot be used here.
        storeOTP: 'hashed',
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        async sendVerificationOTP({ email, otp, type }) {
          const template = {
            'sign-in': 'sign-in-otp',
            'email-verification': 'verify-email-otp',
            'forget-password': 'reset-password-otp',
          } as const;
          return send(
            template[type as keyof typeof template] ?? 'sign-in-otp',
            email,
            {
              otpCode: otp,
              userEmail: email,
              expirationMinutes: '5',
            },
          );
        },
      }),
      passkey({
        rpID: settings.passkeyRpID,
        rpName: settings.appName,
        origin: [settings.appURL],
      }),
      twoFactor({
        issuer: settings.appName,
        // Users sign in without passwords, so 2FA cannot ask for one.
        allowPasswordless: true,
        // Backup codes must be read back, so they are encrypted (not hashed).
        backupCodeOptions: { storeBackupCodes: 'encrypted' },
        otpOptions: {
          // Only a digest is stored; the code sent to the user is unchanged.
          storeOTP: 'hashed',
          async sendOTP({ user, otp }) {
            return send('two-factor', user.email, {
              otpCode: otp,
              userEmail: user.email,
              userName: user.name,
              expirationMinutes: '3',
            });
          },
        },
      }),
      admin(),
      organization({
        ac: organizationAc,
        roles: organizationRoles,
        // Organizations (and the Staff organization) create their own roles.
        dynamicAccessControl: { enabled: true },
        teams: { enabled: true },
        async sendInvitationEmail(data) {
          return send('invitation', data.email, {
            inviteLink: `${settings.appURL}/accept-invitation/${data.id}`,
            inviterName: data.inviter.user.name,
            inviterEmail: data.inviter.user.email,
            organizationName: data.organization.name,
            role: data.role,
          });
        },
      }),
      lastLoginMethod({ storeInDatabase: true }),
      multiSession({ maximumSessions: 5 }),
      // The schema is shown in this API's Swagger and Scalar docs instead.
      openAPI({
        disableDefaultReference: true,
        // A nonce for the reference page's inline script (CSP). New each start.
        nonce: randomBytes(16).toString('base64'),
      }),
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        loginPage: `${settings.appURL}/sign-in`,
        consentPage: `${settings.appURL}/consent`,
        resource: settings.mcpResource,
        scopes: oauthScopes,
        // Register our MCP server with the scopes it accepts. Left out, the
        // plugin saves "no list", which a Postgres list column cannot hold.
        resources: [
          { identifier: settings.mcpResource, allowedScopes: oauthScopes },
        ],
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
      agentAuthPlugin({
        appName: settings.appName,
        appURL: settings.appURL,
        trustProxy: settings.trustProxy,
      }),
      ...(settings.recaptchaSecretKey
        ? [
            captcha({
              provider: 'google-recaptcha',
              secretKey: settings.recaptchaSecretKey,
              // Sending codes is what bots abuse, so check the captcha there.
              endpoints: [
                '/email-otp/send-verification-otp',
                '/sign-in/email-otp',
                '/email-otp/request-password-reset',
              ],
            }),
          ]
        : []),
      // Better Auth Infrastructure, when its key is set: the dashboard, and
      // Sentinel (bot and abuse protection on sign-in and sign-up).
      ...(settings.dashApiKey
        ? [
            dash({ apiKey: settings.dashApiKey }),
            sentinel({
              apiKey: settings.dashApiKey,
              security: sentinelSecurity,
            }),
          ]
        : []),
      ...(settings.testing ? [testUtils({ captureOTP: true })] : []),
    ],
  } satisfies BetterAuthOptions;
}
