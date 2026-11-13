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
    summary: 'My routines',
    description: 'Lists your routines, newest first. Page with "before".',
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
    description: 'Creates a task the agent runs on a schedule.',
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
    description: 'Returns one of your routines and its next run.',
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
    description: 'Changes the name, prompt, schedule, or turns it on/off.',
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
    description: 'Starts a run now; the answer appears as a chat.',
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
    description: 'Past runs of a routine, as chats. Page with "before".',
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
