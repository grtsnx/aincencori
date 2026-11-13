import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { Throttle } from '@nestjs/throttler';
import { CreatePlanDto, ListPlansQueryDto, PlanDto } from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { PlanService } from './plan.service.js';

@Controller({ path: 'plans', version: '1' })
@ApiTags('Plans')
@ApiCookieAuth()
@ApiNotFoundResponse({ description: 'Plan not found' })
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @ApiOperation({
    summary: 'List plans',
    description: 'Lists your plans with their steps, newest first.',
  })
  @ApiOkResponse({ type: [PlanDto] })
  @Get()
  list(
    @CurrentSession() auth: AuthSession,
    @Query() query: ListPlansQueryDto,
  ): Promise<PlanDto[]> {
    return this.planService.list(auth, query);
  }

  @ApiOperation({
    summary: 'Start a plan',
    description: 'Splits a big goal into steps and works through them.',
  })
  @ApiOkResponse({ type: PlanDto })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  create(
    @CurrentSession() auth: AuthSession,
    @Body() body: CreatePlanDto,
  ): Promise<PlanDto> {
    return this.planService.create(auth, body);
  }

  @ApiOperation({
    summary: 'Get a plan',
    description:
      'Returns a plan and its steps. Check again to follow progress.',
  })
  @ApiOkResponse({ type: PlanDto })
  @Get(':id')
  get(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<PlanDto> {
    return this.planService.get(id, auth);
  }

  @ApiOperation({
    summary: 'Stop a plan',
    description: 'Stops a plan after the step running now.',
  })
  @ApiOkResponse({ type: PlanDto })
  @Post(':id/stop')
  @HttpCode(200)
  stop(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<PlanDto> {
    return this.planService.stop(id, auth);
  }

  @ApiOperation({
    summary: 'Resume a plan',
    description: 'Carries on a paused, stopped or failed plan.',
  })
  @ApiOkResponse({ type: PlanDto })
  @Post(':id/resume')
  @HttpCode(200)
  resume(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<PlanDto> {
    return this.planService.resume(id, auth);
  }

  @ApiOperation({
    summary: 'Delete a plan',
    description: 'Deletes a plan. Its chat is kept.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<void> {
    return this.planService.remove(id, auth);
  }
}
