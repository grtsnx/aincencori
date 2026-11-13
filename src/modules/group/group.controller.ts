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
  CreateGroupDto,
  GroupDto,
  ListGroupsQueryDto,
  UpdateGroupDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { GroupService } from './group.service.js';

@Controller({ path: 'groups', version: '1' })
@ApiTags('Groups')
@ApiCookieAuth()
@ApiNotFoundResponse({ description: 'Group not found' })
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  @ApiOperation({
    summary: 'List groups',
    description: 'Lists your teams of bots, newest first.',
  })
  @ApiOkResponse({ type: [GroupDto] })
  @Get()
  list(
    @CurrentSession() auth: AuthSession,
    @Query() query: ListGroupsQueryDto,
  ): Promise<GroupDto[]> {
    return this.groupService.list(auth, query);
  }

  @ApiOperation({
    summary: 'Create a group',
    description: 'Creates a team from 2 to 6 of your bots.',
  })
  @ApiOkResponse({ type: GroupDto })
  @Post()
  @HttpCode(200)
  create(
    @CurrentSession() auth: AuthSession,
    @Body() body: CreateGroupDto,
  ): Promise<GroupDto> {
    return this.groupService.create(auth, body);
  }

  @ApiOperation({
    summary: 'Get a group',
    description: 'Returns one team and the bots in it.',
  })
  @ApiOkResponse({ type: GroupDto })
  @Get(':id')
  get(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<GroupDto> {
    return this.groupService.get(id, auth);
  }

  @ApiOperation({
    summary: 'Update a group',
    description: 'Changes a team: its name, bots, or how they work.',
  })
  @ApiOkResponse({ type: GroupDto })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Body() body: UpdateGroupDto,
  ): Promise<GroupDto> {
    return this.groupService.update(id, auth, body);
  }

  @ApiOperation({
    summary: 'Delete a group',
    description: 'Deletes a team. Its bots are kept.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<void> {
    return this.groupService.remove(id, auth);
  }
}
