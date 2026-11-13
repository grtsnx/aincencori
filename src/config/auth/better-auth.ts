import { agentAuth } from '@better-auth/agent-auth';
import { passkey } from '@better-auth/passkey';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { dash, type EmailTemplateId } from '@better-auth/infra';
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
import { organizationAc, organizationRoles } from './access.js';
import { agentCapabilities, executeAgentCapability } from './agent.js';

// Better Auth serves every auth route under this path.
export const authBasePath = '/api/auth';

// Sends one of the Better Auth dashboard's email templates.
export type AuthMailer = (
  template: EmailTemplateId,
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
  google?: { clientId: string; clientSecret: string };
  recaptchaSecretKey?: string;
  passkeyRpID: string;
  mcpResource: string;
  ipAddressHeaders: string[];
  trustedProxies: string[];
  // Adds Better Auth's test helpers. Never true in production.
  testing: boolean;
  sendEmail: AuthMailer;
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
    template: EmailTemplateId,
    to: string,
    variables: Record<string, string>,
  ) =>
    // Not awaited, so response time does not reveal whether an email exists.
    void settings.sendEmail(template, to, {
      appName: settings.appName,
      ...variables,
    });

  return {
    appName: settings.appName,
    basePath: authBasePath,
    baseURL: settings.baseURL,
    secret: settings.secret,
    trustedOrigins: settings.trustedOrigins,
    telemetry: { enabled: false },

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
    socialProviders: settings.google
      ? { google: { ...settings.google, prompt: 'select_account' as const } }
      : {},

    // A Google sign-in never joins an existing account by matching email.
    // The user signs in first (email OTP), then links Google with linkSocial().
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
      },
    },

    // Shared across instances, so limits hold when the API scales out.
    rateLimit: { storage: 'database' as const },

    // MCP clients get tokens from /oauth2/token, not /token.
    disabledPaths: ['/token'],

    advanced: {
      ...(settings.cookieDomain && {
        crossSubDomainCookies: {
          enabled: true,
          domain: settings.cookieDomain,
        },
      }),
      ipAddress: {
        ...(settings.ipAddressHeaders.length > 0 && {
          ipAddressHeaders: settings.ipAddressHeaders,
        }),
        ...(settings.trustedProxies.length > 0 && {
          trustedProxies: settings.trustedProxies,
        }),
      },
    },

    plugins: [
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
          send(
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
          async sendOTP({ user, otp }) {
            send('two-factor', user.email, {
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
          send('invitation', data.email, {
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
      openAPI({ disableDefaultReference: true }),
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        loginPage: `${settings.appURL}/sign-in`,
        consentPage: `${settings.appURL}/consent`,
        resource: settings.mcpResource,
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
      // AI agents act for a user who approves each capability first.
      agentAuth({
        providerName: settings.appName,
        providerDescription: `${settings.appName} API for AI agents`,
        modes: ['delegated'],
        deviceAuthorizationPage: `${settings.appURL}/device/capabilities`,
        trustProxy: settings.trustedProxies.length > 0,
        capabilities: agentCapabilities,
        onExecute: ({ capability, agentSession }) =>
          executeAgentCapability(capability, agentSession),
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
      ...(settings.dashApiKey ? [dash({ apiKey: settings.dashApiKey })] : []),
      ...(settings.testing ? [testUtils({ captureOTP: true })] : []),
    ],
  } satisfies BetterAuthOptions;
}
