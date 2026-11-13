// Checks that a user may do a staff job (answer chats, review marketplace
// bots...): platform admins always may; staff may when their role in the
// Staff organization has the permission.
import { ForbiddenException } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { staffOrganizationSlug } from '@/config/auth/access.js';
import type {
  AuthSession,
  BetterAuthService,
} from '@/lib/better-auth/better-auth.service.js';
import type { PrismaService } from '@/lib/prisma/prisma.service.js';

export async function assertStaff(
  services: { betterAuth: BetterAuthService; prisma: PrismaService },
  auth: AuthSession,
  headers: IncomingHttpHeaders,
  permissions: Record<string, string[]>,
): Promise<void> {
  const isAdmin = (auth.user as { role?: string | null }).role
    ?.split(',')
    .includes('admin');
  if (isAdmin) return;
  const staff = await services.prisma.db.organization.findUnique({
    where: { slug: staffOrganizationSlug },
  });
  const result = staff
    ? await services.betterAuth.auth.api.hasPermission({
        headers: fromNodeHeaders(headers),
        body: { organizationId: staff.id, permissions },
      })
    : { success: false };
  if (!result.success) {
    throw new ForbiddenException('You are not allowed to do this.');
  }
}
