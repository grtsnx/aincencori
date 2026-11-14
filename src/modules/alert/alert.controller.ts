import { Controller, Get, Headers } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { IncomingHttpHeaders } from 'node:http';
import { AlertDto } from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { AlertService } from './alert.service.js';

@Controller({ path: 'admin/alerts', version: '1' })
@ApiTags('Admin')
@ApiCookieAuth()
export class AlertController {
  constructor(private readonly alertService: AlertService) {}

  @ApiOperation({
    summary: 'List alerts',
    description:
      'What broke: outside services and server errors, newest first.',
  })
  @ApiOkResponse({ type: [AlertDto] })
  @ApiForbiddenResponse({ description: 'Not staff' })
  @Get()
  list(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<AlertDto[]> {
    return this.alertService.list(auth, headers);
  }
}
