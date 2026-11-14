import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'node:crypto';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

// What happened to one push.
export type PushResult = 'sent' | 'gone' | 'failed';

// Push notifications to phones and browsers with Firebase Cloud Messaging
// (free, no limit). Set FIREBASE_SERVICE_ACCOUNT to the service account JSON
// from Firebase (Project settings > Service accounts), as is or base64.
// Without it, nothing is pushed and the app inbox and email still work.
@Injectable()
export class FirebaseService {
  private readonly account: ServiceAccount | null;
  private token: { value: string; until: number } | null = null;
  // Tests swap in a stand-in.
  fetch: typeof fetch = (input, init) => fetch(input, init);

  constructor(config: ConfigService) {
    this.account = readAccount(config.get<string>('FIREBASE_SERVICE_ACCOUNT'));
  }

  get isConfigured(): boolean {
    return this.account !== null;
  }

  // Sends one push. "gone" means the device no longer exists: forget it.
  async push(
    deviceToken: string,
    message: { title: string; body: string; link?: string | null },
  ): Promise<PushResult> {
    if (!this.account) return 'failed';
    const response = await this.fetch(
      `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: { title: message.title, body: message.body },
            ...(message.link && {
              data: { link: message.link },
              webpush: { fcm_options: { link: message.link } },
            }),
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.ok) return 'sent';
    const text = await response.text();
    // The app was removed, or the token was replaced.
    if (
      response.status === 404 ||
      /UNREGISTERED|registration-token-not-registered/i.test(text)
    ) {
      return 'gone';
    }
    throw new Error(
      `Firebase answered ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  // A short-lived Google access token, signed with the service account.
  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now() + 60_000) {
      return this.token.value;
    }
    const account = this.account!;
    const now = Math.floor(Date.now() / 1000);
    const part = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(account.private_key)
      .toString('base64url');
    const response = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(
        `Google refused the Firebase key (${response.status}): ${(await response.text()).slice(0, 200)}`,
      );
    }
    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = {
      value: data.access_token,
      until: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  }
}

// The service account, from JSON or base64 JSON. Null when not set or broken.
function readAccount(value?: string): ServiceAccount | null {
  if (!value?.trim()) return null;
  const text = value.trim().startsWith('{')
    ? value
    : Buffer.from(value, 'base64').toString('utf8');
  try {
    const account = JSON.parse(text) as Partial<ServiceAccount>;
    if (!account.project_id || !account.client_email || !account.private_key) {
      return null;
    }
    return {
      project_id: account.project_id,
      client_email: account.client_email,
      private_key: account.private_key.replace(/\\n/g, '\n'),
    };
  } catch {
    return null;
  }
}
