import { All, Controller, Req, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '@/middleware';
import { McpService } from './mcp.service.js';

// The MCP endpoint, at /mcp (no version: it is the address MCP apps are
// given). @Public for our cookie guard only: every call must carry an access
// token from Better Auth, checked in the service.
@Controller({ path: 'mcp', version: VERSION_NEUTRAL })
@ApiExcludeController()
@Public()
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @All()
  @SkipThrottle({ default: false })
  handle(@Req() request: Request, @Res() response: Response): Promise<void> {
    return this.mcpService.handle(request, response);
  }
}
