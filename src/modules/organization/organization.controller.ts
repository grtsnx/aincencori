import { Controller, Get, Headers } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { IncomingHttpHeaders } from 'node:http';
import {
  OrganizationDetailsDto,
  OrganizationDto,
  PermissionCatalogDto,
} from '@/dto';
import { OrganizationService } from './organization.service.js';

@Controller({ path: 'organizations', version: '1' })
@ApiTags('Organization')
@ApiCookieAuth()
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @ApiOperation({
    summary: 'My organizations',
    description: 'Lists organizations the user belongs to.',
  })
  @ApiOkResponse({ type: [OrganizationDto] })
  @Get()
  list(@Headers() headers: IncomingHttpHeaders): Promise<OrganizationDto[]> {
    return this.organizationService.list(headers);
  }

  @ApiOperation({
    summary: 'Active organization',
    description:
      'Returns the active organization with members, teams, invites.',
  })
  @ApiOkResponse({ type: OrganizationDetailsDto })
  @Get('active')
  active(
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<OrganizationDetailsDto> {
    return this.organizationService.active(headers);
  }

  @ApiOperation({
    summary: 'List permissions',
    description: 'Every permission an organization role can be given.',
  })
  @ApiOkResponse({ type: PermissionCatalogDto })
  @Get('permissions')
  permissions(): PermissionCatalogDto {
    return this.organizationService.permissions();
  }
}
