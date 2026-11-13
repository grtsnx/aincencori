import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Put,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { IncomingHttpHeaders } from 'node:http';
import { SetBillingPlanDto, UsageDto, UsageOverviewDto } from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { UsageService } from './usage.service.js';

@Controller({ version: '1' })
@ApiCookieAuth()
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @ApiTags('Usage')
  @ApiOperation({
    summary: 'Get my usage',
    description: 'Your plan, this month’s AI spend and what is left.',
  })
  @ApiOkResponse({ type: UsageDto })
  @Get('usage')
  mine(@CurrentSession() auth: AuthSession): Promise<UsageDto> {
    return this.usageService.mine(auth);
  }

  @ApiTags('Admin')
  @ApiOperation({
    summary: 'Get usage overview',
    description: 'This month’s AI spend across users, biggest first.',
  })
  @ApiOkResponse({ type: UsageOverviewDto })
  @ApiForbiddenResponse({ description: 'Not staff' })
  @Get('admin/usage')
  overview(
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<UsageOverviewDto> {
    return this.usageService.overview(auth, headers);
  }

  @ApiTags('Admin')
  @ApiOperation({
    summary: 'Get user usage',
    description: 'One user’s plan and AI spend this month.',
  })
  @ApiOkResponse({ type: UsageDto })
  @ApiForbiddenResponse({ description: 'Not staff' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @Get('admin/users/:id/usage')
  forUser(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<UsageDto> {
    return this.usageService.forUser(auth, headers, id);
  }

  @ApiTags('Admin')
  @ApiOperation({
    summary: 'Set user plan',
    description: 'Moves a user to a plan, or sets their own allowance.',
  })
  @ApiOkResponse({ type: UsageDto })
  @ApiForbiddenResponse({ description: 'Not staff' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @Put('admin/users/:id/plan')
  @HttpCode(200)
  setPlan(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
    @Body() body: SetBillingPlanDto,
  ): Promise<UsageDto> {
    return this.usageService.setPlan(auth, headers, id, body);
  }
}
