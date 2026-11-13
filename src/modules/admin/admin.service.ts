import { Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import type { ListUsersQueryDto, UserListDto } from '@/dto';
import { BetterAuthService } from '@/lib/better-auth/better-auth.service.js';

// Calls Better Auth's admin API as the signed-in user, so only admins get
// through (Better Auth answers 403 otherwise). Banning, impersonating and
// changing roles go through Better Auth's /api/auth/admin/* routes.
@Injectable()
export class AdminService {
  constructor(private readonly betterAuth: BetterAuthService) {}

  async listUsers(
    headers: IncomingHttpHeaders,
    query: ListUsersQueryDto,
  ): Promise<UserListDto> {
    const result = await this.betterAuth.auth.api.listUsers({
      headers: fromNodeHeaders(headers),
      query: {
        limit: query.limit ?? 25,
        offset: query.offset ?? 0,
        sortBy: 'createdAt',
        sortDirection: 'desc',
        ...(query.search && {
          searchValue: query.search,
          searchField: query.search.includes('@') ? 'email' : 'name',
          searchOperator: 'contains',
        }),
      },
    });

    return {
      total: result.total,
      users: result.users.map((user) => {
        const extra = user as typeof user & {
          role?: string | null;
          banned?: boolean | null;
          lastLoginMethod?: string | null;
        };
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          role: extra.role ?? 'user',
          banned: extra.banned ?? false,
          lastLoginMethod: extra.lastLoginMethod ?? null,
          createdAt: user.createdAt,
        };
      }),
    };
  }
}
