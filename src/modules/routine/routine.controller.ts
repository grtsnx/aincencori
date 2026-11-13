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
  ChatSessionDto,
  CreateRoutineDto,
  ListRoutinesQueryDto,
  RoutineDto,
  UpdateRoutineDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { RoutineService } from './routine.service.js';

@Controller({ path: 'routines', version: '1' })
@ApiTags('Routines')
@ApiCookieAuth()
@ApiNotFoundResponse({ description: 'Routine not found' })
export class RoutineController {
  constructor(private readonly routineService: RoutineService) {}

  @ApiOperation({
    summary: 'List routines',
    description: 'Lists your scheduled tasks, newest first.',
  })
  @ApiOkResponse({ type: [RoutineDto] })
  @Get()
  list(
    @CurrentSession() auth: AuthSession,
    @Query() query: ListRoutinesQueryDto,
  ): Promise<RoutineDto[]> {
    return this.routineService.list(auth, query);
  }

  @ApiOperation({
    summary: 'Create a routine',
    description: 'Creates a task that a bot runs on a schedule.',
  })
  @ApiOkResponse({ type: RoutineDto })
  @Post()
  @HttpCode(200)
  create(
    @CurrentSession() auth: AuthSession,
    @Body() body: CreateRoutineDto,
  ): Promise<RoutineDto> {
    return this.routineService.create(auth, body);
  }

  @ApiOperation({
    summary: 'Get a routine',
    description: 'Returns one scheduled task and when it runs next.',
  })
  @ApiOkResponse({ type: RoutineDto })
  @Get(':id')
  get(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<RoutineDto> {
    return this.routineService.get(id, auth);
  }

  @ApiOperation({
    summary: 'Update a routine',
    description: 'Changes a scheduled task, or pauses and resumes it.',
  })
  @ApiOkResponse({ type: RoutineDto })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Body() body: UpdateRoutineDto,
  ): Promise<RoutineDto> {
    return this.routineService.update(id, auth, body);
  }

  @ApiOperation({
    summary: 'Delete a routine',
    description: 'Deletes a routine and stops its schedule.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<void> {
    return this.routineService.remove(id, auth);
  }

  @ApiOperation({
    summary: 'Run a routine now',
    description: 'Runs the task now. The answer arrives as a chat.',
  })
  @ApiOkResponse({ type: RoutineDto })
  @Post(':id/run')
  @HttpCode(200)
  run(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<RoutineDto> {
    return this.routineService.runNow(id, auth);
  }

  @ApiOperation({
    summary: 'Routine runs',
    description: 'Lists the past runs of a task, newest first.',
  })
  @ApiOkResponse({ type: [ChatSessionDto] })
  @Get(':id/runs')
  runs(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Query() query: ListRoutinesQueryDto,
  ): Promise<ChatSessionDto[]> {
    return this.routineService.runs(id, auth, query);
  }
}
