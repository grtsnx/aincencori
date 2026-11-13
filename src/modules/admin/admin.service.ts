import { ForbiddenException, Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import {
  organizationRoles,
  permissionCatalog,
  staffOrganizationSlug,
} from '@/config/auth/access.js';
import type {
  CreateRoleDto,
  InviteStaffDto,
  ListUsersQueryDto,
  PermissionCatalogDto,
  RoleDto,
  StaffInvitationDto,
  StaffMemberDto,
  UpdateRoleDto,
  UserListDto,
} from '@/dto';
import {
  type AuthSession,
  BetterAuthService,
} from '@/lib/better-auth/better-auth.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

type StaffPermission = 'invite' | 'list' | 'update' | 'remove';

interface StoredRole {
  id: string;
  role: string;
  permission: string | Record<string, string[]>;
}

// Platform admins (Better Auth admin role "admin") can do everything here.
// Staff are members of the Staff organization; their role decides what they
// may do, checked by Better Auth. Calls run as the signed-in user, so Better
// Auth's own permission checks always apply.
@Injectable()
export class AdminService {
  constructor(
    private readonly betterAuth: BetterAuthService,
    private readonly prisma: PrismaService,
  ) {}

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

  // Staff

  async listStaff(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
  ): Promise<StaffMemberDto[]> {
    const organizationId = await this.authorize(auth, headers, 'list');
    const result = await this.betterAuth.auth.api.listMembers({
      headers: fromNodeHeaders(headers),
      query: { organizationId, limit: 100 },
    });
    return result.members.map((member) => ({
      id: member.id,
      role: member.role,
      createdAt: member.createdAt,
      user: {
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
      },
    }));
  }

  async inviteStaff(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    body: InviteStaffDto,
  ): Promise<StaffInvitationDto> {
    const organizationId = await this.authorize(auth, headers, 'invite');
    const invitation = await this.betterAuth.auth.api.createInvitation({
      headers: fromNodeHeaders(headers),
      body: {
        organizationId,
        email: body.email,
        role: body.role as 'member',
      },
    });
    return this.toInvitation(invitation);
  }

  async listStaffInvitations(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
  ): Promise<StaffInvitationDto[]> {
    const organizationId = await this.authorize(auth, headers, 'list');
    const invitations = await this.betterAuth.auth.api.listInvitations({
      headers: fromNodeHeaders(headers),
      query: { organizationId },
    });
    return invitations.map((invitation) => this.toInvitation(invitation));
  }

  async updateStaffRole(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    memberId: string,
    role: string,
  ): Promise<StaffMemberDto> {
    const organizationId = await this.authorize(auth, headers, 'update');
    const member = await this.betterAuth.auth.api.updateMemberRole({
      headers: fromNodeHeaders(headers),
      body: { organizationId, memberId, role: role as 'member' },
    });
    const user = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: member.userId },
    });
    return {
      id: member.id,
      role: member.role,
      createdAt: member.createdAt,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }

  async removeStaff(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    memberId: string,
  ): Promise<void> {
    const organizationId = await this.authorize(auth, headers, 'remove');
    await this.betterAuth.auth.api.removeMember({
      headers: fromNodeHeaders(headers),
      body: { organizationId, memberIdOrEmail: memberId },
    });
  }

  // Roles and permissions

  permissions(): PermissionCatalogDto {
    return { permissions: permissionCatalog };
  }

  async listRoles(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
  ): Promise<RoleDto[]> {
    const organizationId = await this.authorize(auth, headers, 'list');
    const custom = (await this.betterAuth.auth.api.listOrgRoles({
      headers: fromNodeHeaders(headers),
      query: { organizationId },
    })) as StoredRole[];

    const builtIn: RoleDto[] = Object.entries(organizationRoles).map(
      ([name, role]) => ({
        id: null,
        name,
        permissions: role.statements as unknown as Record<string, string[]>,
        builtIn: true,
      }),
    );
    return [...builtIn, ...custom.map((role) => this.toRole(role))];
  }

  async createRole(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    body: CreateRoleDto,
  ): Promise<RoleDto> {
    const organizationId = await this.authorize(auth, headers, 'update');
    const result = (await this.betterAuth.auth.api.createOrgRole({
      headers: fromNodeHeaders(headers),
      body: { organizationId, role: body.name, permission: body.permissions },
    })) as { roleData: StoredRole };
    return this.toRole(result.roleData);
  }

  async updateRole(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    roleId: string,
    body: UpdateRoleDto,
  ): Promise<RoleDto> {
    const organizationId = await this.authorize(auth, headers, 'update');
    const result = (await this.betterAuth.auth.api.updateOrgRole({
      headers: fromNodeHeaders(headers),
      body: { organizationId, roleId, data: { permission: body.permissions } },
    })) as { roleData: StoredRole };
    return this.toRole(result.roleData);
  }

  async deleteRole(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    roleId: string,
  ): Promise<void> {
    const organizationId = await this.authorize(auth, headers, 'update');
    await this.betterAuth.auth.api.deleteOrgRole({
      headers: fromNodeHeaders(headers),
      body: { organizationId, roleId },
    });
  }

  // Lets platform admins through (and makes them owners of the Staff
  // organization), and staff whose role has the staff permission.
  private async authorize(
    auth: AuthSession,
    headers: IncomingHttpHeaders,
    permission: StaffPermission,
  ): Promise<string> {
    const isAdmin = (auth.user as { role?: string | null }).role
      ?.split(',')
      .includes('admin');
    const organizationId = await this.staffOrganizationId(
      isAdmin ? auth.user.id : undefined,
    );
    if (isAdmin) return organizationId;

    const result = await this.betterAuth.auth.api.hasPermission({
      headers: fromNodeHeaders(headers),
      body: { organizationId, permissions: { staff: [permission] } },
    });
    if (!result.success) {
      throw new ForbiddenException('You are not allowed to do this.');
    }
    return organizationId;
  }

  // The Staff organization, created the first time an admin needs it.
  private async staffOrganizationId(adminUserId?: string): Promise<string> {
    const slug = staffOrganizationSlug;
    const db = this.prisma.db;
    let organization = await db.organization.findUnique({ where: { slug } });

    if (!organization) {
      if (!adminUserId) {
        throw new ForbiddenException('You are not allowed to do this.');
      }
      await this.betterAuth.auth.api.createOrganization({
        body: { name: 'Staff', slug, userId: adminUserId },
      });
      organization = await db.organization.findUniqueOrThrow({
        where: { slug },
      });
    }

    if (adminUserId) {
      const member = await db.member.findFirst({
        where: { organizationId: organization.id, userId: adminUserId },
      });
      if (!member) {
        await this.betterAuth.auth.api.addMember({
          body: {
            organizationId: organization.id,
            userId: adminUserId,
            role: 'owner',
          },
        });
      }
    }
    return organization.id;
  }

  private toInvitation(invitation: {
    id: string;
    email: string;
    role?: string | null;
    status: string;
    expiresAt: Date;
  }): StaffInvitationDto {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role ?? null,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    };
  }

  private toRole(role: StoredRole): RoleDto {
    return {
      id: role.id,
      name: role.role,
      permissions:
        typeof role.permission === 'string'
          ? (JSON.parse(role.permission) as Record<string, string[]>)
          : role.permission,
      builtIn: false,
    };
  }
}
