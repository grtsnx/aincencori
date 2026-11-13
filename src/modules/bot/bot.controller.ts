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
  BotDto,
  BotMemoryDto,
  BotSkillDto,
  CreateBotDto,
  CreateBotMemoryDto,
  CreateBotSkillDto,
  ListBotsQueryDto,
  UpdateBotDto,
  UpdateBotSkillDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { BotService } from './bot.service.js';

@Controller({ path: 'bots', version: '1' })
@ApiTags('Bots')
@ApiCookieAuth()
@ApiNotFoundResponse({ description: 'Bot not found' })
export class BotController {
  constructor(private readonly botService: BotService) {}

  @ApiOperation({
    summary: 'List bots',
    description: 'Lists your bots, newest first. Page with "before".',
  })
  @ApiOkResponse({ type: [BotDto] })
  @Get()
  list(
    @CurrentSession() auth: AuthSession,
    @Query() query: ListBotsQueryDto,
  ): Promise<BotDto[]> {
    return this.botService.list(auth, query);
  }

  @ApiOperation({
    summary: 'Create a bot',
    description: 'Only name and instructions are needed; the rest is optional.',
  })
  @ApiOkResponse({ type: BotDto })
  @Post()
  @HttpCode(200)
  create(
    @CurrentSession() auth: AuthSession,
    @Body() body: CreateBotDto,
  ): Promise<BotDto> {
    return this.botService.create(auth, body);
  }

  @ApiOperation({
    summary: 'Get a bot',
    description: 'Returns one of your bots and its integrations.',
  })
  @ApiOkResponse({ type: BotDto })
  @Get(':id')
  get(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<BotDto> {
    return this.botService.get(id, auth);
  }

  @ApiOperation({
    summary: 'Update a bot',
    description: 'Changes the name, instructions, integrations, or on/off.',
  })
  @ApiOkResponse({ type: BotDto })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Body() body: UpdateBotDto,
  ): Promise<BotDto> {
    return this.botService.update(id, auth, body);
  }

  @ApiOperation({
    summary: 'Delete a bot',
    description: 'Deletes a bot. Its chats and your integrations stay.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<void> {
    return this.botService.remove(id, auth);
  }

  @ApiOperation({
    summary: 'List bot memories',
    description: 'Facts the bot knows, newest first. Page with "before".',
  })
  @ApiOkResponse({ type: [BotMemoryDto] })
  @Get(':id/memories')
  memories(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Query() query: ListBotsQueryDto,
  ): Promise<BotMemoryDto[]> {
    return this.botService.memories(id, auth, query);
  }

  @ApiOperation({
    summary: 'Add a memory',
    description: 'Teaches the bot a fact it uses in every chat.',
  })
  @ApiOkResponse({ type: BotMemoryDto })
  @Post(':id/memories')
  @HttpCode(200)
  addMemory(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Body() body: CreateBotMemoryDto,
  ): Promise<BotMemoryDto> {
    return this.botService.addMemory(id, auth, body);
  }

  @ApiOperation({
    summary: 'Delete a memory',
    description: 'Makes the bot forget one fact.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @Delete(':id/memories/:memoryId')
  @HttpCode(204)
  removeMemory(
    @Param('id') id: string,
    @Param('memoryId') memoryId: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<void> {
    return this.botService.removeMemory(id, memoryId, auth);
  }

  @ApiOperation({
    summary: 'List bot skills',
    description: 'Playbooks the bot can run.',
  })
  @ApiOkResponse({ type: [BotSkillDto] })
  @Get(':id/skills')
  skills(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<BotSkillDto[]> {
    return this.botService.skills(id, auth);
  }

  @ApiOperation({
    summary: 'Add a skill',
    description: 'Gives the bot a playbook. It is safety-scanned first.',
  })
  @ApiOkResponse({ type: BotSkillDto })
  @Post(':id/skills')
  @HttpCode(200)
  addSkill(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Body() body: CreateBotSkillDto,
  ): Promise<BotSkillDto> {
    return this.botService.addSkill(id, auth, body);
  }

  @ApiOperation({
    summary: 'Update a skill',
    description: 'Changes a skill; each change is a new version.',
  })
  @ApiOkResponse({ type: BotSkillDto })
  @Patch(':id/skills/:skillId')
  updateSkill(
    @Param('id') id: string,
    @Param('skillId') skillId: string,
    @CurrentSession() auth: AuthSession,
    @Body() body: UpdateBotSkillDto,
  ): Promise<BotSkillDto> {
    return this.botService.updateSkill(id, skillId, auth, body);
  }

  @ApiOperation({
    summary: 'Delete a skill',
    description: 'Removes a skill from the bot.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @Delete(':id/skills/:skillId')
  @HttpCode(204)
  removeSkill(
    @Param('id') id: string,
    @Param('skillId') skillId: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<void> {
    return this.botService.removeSkill(id, skillId, auth);
  }
}
