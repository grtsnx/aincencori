import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateIntegrationDto,
  IntegrationDto,
  IntegrationToolDto,
  ListIntegrationsQueryDto,
  UpdateIntegrationDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { IntegrationService } from './integration.service.js';

@Controller({ path: 'integrations', version: '1' })
@ApiTags('Integrations')
@ApiCookieAuth()
@ApiNotFoundResponse({ description: 'Integration not found' })
export class IntegrationController {
  constructor(private readonly integrationService: IntegrationService) {}

  @ApiOperation({
    summary: 'List integrations',
    description: 'Lists your connected MCP servers. Page with "before".',
  })
  @ApiOkResponse({ type: [IntegrationDto] })
  @Get()
  list(
    @CurrentSession() auth: AuthSession,
    @Query() query: ListIntegrationsQueryDto,
  ): Promise<IntegrationDto[]> {
    return this.integrationService.list(auth, query);
  }

  @ApiOperation({
    summary: 'Connect an integration',
    description: 'Connects an MCP server whose tools the agent can use.',
  })
  @ApiOkResponse({ type: IntegrationDto })
  @Post()
  @HttpCode(200)
  create(
    @CurrentSession() auth: AuthSession,
    @Body() body: CreateIntegrationDto,
  ): Promise<IntegrationDto> {
    return this.integrationService.create(auth, body);
  }

  @ApiOperation({
    summary: 'Update an integration',
    description: 'Changes the name, address, token, or turns it on/off.',
  })
  @ApiOkResponse({ type: IntegrationDto })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Body() body: UpdateIntegrationDto,
  ): Promise<IntegrationDto> {
    return this.integrationService.update(id, auth, body);
  }

  @ApiOperation({
    summary: 'Remove an integration',
    description: 'Disconnects an MCP server and deletes its token.',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<void> {
    return this.integrationService.remove(id, auth);
  }

  @ApiOperation({
    summary: 'List integration tools',
    description: 'Connects now and lists the tools the server offers.',
  })
  @ApiOkResponse({ type: [IntegrationToolDto] })
  @Get(':id/tools')
  tools(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<IntegrationToolDto[]> {
    return this.integrationService.tools(id, auth);
  }
}
