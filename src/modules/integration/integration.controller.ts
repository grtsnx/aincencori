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
  IntegrationAppDto,
  IntegrationConnectDto,
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
    summary: 'List apps',
    description: 'Lists the apps you can connect, like Gmail and Slack.',
  })
  @ApiOkResponse({ type: [IntegrationAppDto] })
  @Get('apps')
  apps(): Promise<IntegrationAppDto[]> {
    return this.integrationService.apps();
  }

  @ApiOperation({
    summary: 'List integrations',
    description: 'Lists the apps you connected and whether each is ready.',
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
    description: 'Adds an app or your own MCP server.',
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
    description: 'Renames an integration, or turns it on or off.',
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
    description: 'Disconnects an app and removes it from every bot.',
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
    summary: 'Sign in to app',
    description: 'Returns the link where you sign in to the app.',
  })
  @ApiOkResponse({ type: IntegrationConnectDto })
  @Post(':id/connect')
  @HttpCode(200)
  connect(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<IntegrationConnectDto> {
    return this.integrationService.connect(id, auth);
  }

  @ApiOperation({
    summary: 'List integration tools',
    description: 'Checks your own MCP server and lists its tools.',
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
