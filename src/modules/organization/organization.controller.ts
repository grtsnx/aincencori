import { Controller, Get, Headers } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { IncomingHttpHeaders } from 'node:http';
import { OrganizationDetailsDto, OrganizationDto } from '@/dto';
import { OrganizationService } from './organization.service.js';

@Controller({ path: 'organizations', version: '1' })
@ApiTags('Organization')
@ApiCookieAuth()
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @ApiOperation({ summary: 'My organizations' })
  @ApiOkResponse({ type: [OrganizationDto] })
  @Get()
  list(@Headers() headers: IncomingHttpHeaders): Promise<OrganizationDto[]> {
    return this.organizationService.list(headers);
  }

  @ApiOperation({ summary: 'Active organization' })
  @ApiOkResponse({ type: OrganizationDetailsDto })
  @Get('active')
  active(
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<OrganizationDetailsDto> {
    return this.organizationService.active(headers);
  }
}
