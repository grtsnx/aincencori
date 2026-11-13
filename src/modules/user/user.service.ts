import { Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import type { LinkedAccountDto, UserProfileDto, UserSessionDto } from '@/dto';
import {
  BetterAuthService,
  type AuthSession,
} from '@/lib/better-auth/better-auth.service.js';

// Reads the signed-in user's own data through Better Auth. Changing the
// profile, email, linked accounts or sessions goes through Better Auth's
// /v1/auth/* routes (update-user, link-social, revoke-session, ...).
@Injectable()
export class UserService {
  constructor(private readonly betterAuth: BetterAuthService) {}

  profile({ user }: AuthSession): UserProfileDto {
    const extra = user as typeof user & {
      role?: string | null;
      twoFactorEnabled?: boolean | null;
      lastLoginMethod?: string | null;
    };
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image ?? null,
      role: extra.role ?? 'user',
      twoFactorEnabled: extra.twoFactorEnabled ?? false,
      lastLoginMethod: extra.lastLoginMethod ?? null,
      createdAt: user.createdAt,
    };
  }

  async accounts(headers: IncomingHttpHeaders): Promise<LinkedAccountDto[]> {
    const accounts = await this.betterAuth.auth.api.listUserAccounts({
      headers: fromNodeHeaders(headers),
    });
    return accounts.map((account) => ({
      id: account.id,
      providerId: account.providerId,
      createdAt: account.createdAt,
    }));
  }

  async sessions(
    headers: IncomingHttpHeaders,
    current: AuthSession,
  ): Promise<UserSessionDto[]> {
    const sessions = await this.betterAuth.auth.api.listSessions({
      headers: fromNodeHeaders(headers),
    });
    return sessions.map((session) => ({
      id: session.id,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
      current: session.id === current.session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    }));
  }
}
