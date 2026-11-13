import { Controller, Get, Headers, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { IncomingHttpHeaders } from 'node:http';
import {
  AgentCapabilityDto,
  AgentConfigurationDto,
  AgentSessionDto,
} from '@/dto';
import { Public } from '@/middleware';
import { AgentAuthService } from './agent-auth.service.js';

// Agents use their own signed token, not a user's cookie, so these routes skip
// the user sign-in check and verify the agent token themselves.
@Controller({ path: 'agent-auth', version: '1' })
@ApiTags('Agent Auth')
@Public()
export class AgentAuthController {
  constructor(private readonly agentAuthService: AgentAuthService) {}

  @ApiOperation({
    summary: 'Agent discovery',
    description: 'Tells agents how to register and what they can do.',
  })
  @ApiOkResponse({ type: AgentConfigurationDto })
  @Get('configuration')
  configuration(): Promise<AgentConfigurationDto> {
    return this.agentAuthService.configuration();
  }

  @ApiOperation({
    summary: 'Agent capabilities',
    description: 'Lists what agents can ask a user to allow.',
  })
  @ApiOkResponse({ type: [AgentCapabilityDto] })
  @Get('capabilities')
  capabilities(): AgentCapabilityDto[] {
    return this.agentAuthService.capabilities();
  }

  @ApiOperation({
    summary: 'Current agent',
    description: 'Returns the calling agent and the user it serves.',
  })
  @ApiBearerAuth()
  @ApiOkResponse({ type: AgentSessionDto })
  @Get('session')
  session(
    @Headers() headers: IncomingHttpHeaders,
    @Req() request: { originalUrl: string },
  ): Promise<AgentSessionDto> {
    return this.agentAuthService.session(headers, request.originalUrl);
  }
}
