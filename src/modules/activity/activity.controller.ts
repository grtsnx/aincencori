import { Controller, Get, Headers, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { IncomingHttpHeaders } from 'node:http';
import { ActivityDto, AdminActivityQueryDto, ListActivityQueryDto } from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { ActivityService } from './activity.service.js';

@Controller({ version: '1' })
@ApiCookieAuth()
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @ApiTags('Activity')
  @ApiOperation({
    summary: 'List my activity',
    description: 'Sign-ins, changes and what your AI did, newest first.',
  })
  @ApiOkResponse({ type: [ActivityDto] })
  @Get('activity')
  list(
    @CurrentSession() auth: AuthSession,
    @Query() query: ListActivityQueryDto,
  ): Promise<ActivityDto[]> {
    return this.activityService.list(auth, query);
  }

  @ApiTags('Admin')
  @ApiOperation({
    summary: 'List all activity',
    description: 'Activity across every account, for staff. Filter by user.',
  })
  @ApiOkResponse({ type: [ActivityDto] })
  @ApiForbiddenResponse({ description: 'Not staff' })
  @Get('admin/activity')
  listAll(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
    @Query() query: AdminActivityQueryDto,
  ): Promise<ActivityDto[]> {
    return this.activityService.listAll(auth, headers, query);
  }
}
