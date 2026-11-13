import { Injectable, NotFoundException } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import type { OrganizationDetailsDto, OrganizationDto } from '@/dto';
import { BetterAuthService } from '@/lib/better-auth/better-auth.service.js';

interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt: Date;
}

// Reads organizations through Better Auth as the signed-in user, so its
// membership and role checks always apply. Creating, inviting and managing
// members and teams go through Better Auth's /api/auth/organization/* routes.
@Injectable()
export class OrganizationService {
  constructor(private readonly betterAuth: BetterAuthService) {}

  async list(headers: IncomingHttpHeaders): Promise<OrganizationDto[]> {
    const organizations = await this.betterAuth.auth.api.listOrganizations({
      headers: fromNodeHeaders(headers),
    });
    return organizations.map((organization) => this.toDto(organization));
  }

  async active(headers: IncomingHttpHeaders): Promise<OrganizationDetailsDto> {
    const organization = await this.betterAuth.auth.api.getFullOrganization({
      headers: fromNodeHeaders(headers),
    });
    if (!organization) {
      throw new NotFoundException(
        'No active organization. Set one with /api/auth/organization/set-active.',
      );
    }

    return {
      ...this.toDto(organization),
      members: organization.members.map((member) => ({
        id: member.id,
        role: member.role,
        user: {
          id: member.user.id,
          name: member.user.name,
          email: member.user.email,
        },
      })),
      teams: (organization.teams ?? []).map((team) => ({
        id: team.id,
        name: team.name,
        createdAt: team.createdAt,
      })),
      invitations: organization.invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role ?? null,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      })),
    };
  }

  private toDto(organization: OrganizationRecord): OrganizationDto {
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo ?? null,
      createdAt: organization.createdAt,
    };
  }
}
