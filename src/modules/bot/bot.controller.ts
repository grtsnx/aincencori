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
  BotSuggestionDto,
  CreateBotDto,
  CreateBotMemoryDto,
  CreateBotSkillDto,
  InstallSkillDto,
  ListBotsQueryDto,
  PreviewSkillImportDto,
  SkillImportPreviewDto,
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
    description: 'Lists the bots you created, newest first.',
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
    description: 'Creates a bot from a name and instructions.',
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
    description: 'Returns one bot with the integrations it can use.',
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
    description: 'Changes a bot, or turns it on or off.',
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
    description: 'Deletes a bot. Its past chats are kept.',
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
    description: 'Lists the facts a bot knows, newest first.',
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
    description: 'Teaches a bot a fact to use in every chat.',
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
    description: 'Makes a bot forget one fact.',
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
    summary: 'List bot suggestions',
    description:
      'Changes the bot suggests to itself after learning from chats.',
  })
  @ApiOkResponse({ type: [BotSuggestionDto] })
  @Get(':id/suggestions')
  suggestions(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<BotSuggestionDto[]> {
    return this.botService.suggestions(id, auth);
  }

  @ApiOperation({
    summary: 'Accept a suggestion',
    description: 'Makes the suggested change to the bot, exactly as shown.',
  })
  @ApiOkResponse({ type: BotSuggestionDto })
  @Post(':id/suggestions/:suggestionId/accept')
  @HttpCode(200)
  acceptSuggestion(
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<BotSuggestionDto> {
    return this.botService.acceptSuggestion(id, suggestionId, auth);
  }

  @ApiOperation({
    summary: 'Dismiss a suggestion',
    description: 'Leaves the bot as it is.',
  })
  @ApiOkResponse({ type: BotSuggestionDto })
  @Post(':id/suggestions/:suggestionId/dismiss')
  @HttpCode(200)
  dismissSuggestion(
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<BotSuggestionDto> {
    return this.botService.dismissSuggestion(id, suggestionId, auth);
  }

  @ApiTags('Skills')
  @ApiOperation({
    summary: 'List bot skills',
    description: 'Lists the step-by-step playbooks a bot can follow.',
  })
  @ApiOkResponse({ type: [BotSkillDto] })
  @Get(':id/skills')
  skills(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<BotSkillDto[]> {
    return this.botService.skills(id, auth);
  }

  @ApiTags('Skills')
  @ApiOperation({
    summary: 'Add a skill',
    description: 'Gives a bot a new playbook, after a safety scan.',
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

  @ApiTags('Skills')
  @ApiOperation({
    summary: 'Preview a skill',
    description: 'Reads a SKILL.md from a link or text, safety scanned.',
  })
  @ApiOkResponse({ type: SkillImportPreviewDto })
  @Post(':id/skills/import/preview')
  @HttpCode(200)
  previewSkill(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Body() body: PreviewSkillImportDto,
  ): Promise<SkillImportPreviewDto> {
    return this.botService.previewSkill(id, auth, body);
  }

  @ApiTags('Skills')
  @ApiOperation({
    summary: 'Install a skill',
    description: 'Adds a previewed skill to the bot.',
  })
  @ApiOkResponse({ type: BotSkillDto })
  @Post(':id/skills/import')
  @HttpCode(200)
  installSkill(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
    @Body() body: InstallSkillDto,
  ): Promise<BotSkillDto> {
    return this.botService.installSkill(id, auth, body);
  }

  @ApiTags('Skills')
  @ApiOperation({
    summary: 'Update a skill',
    description: 'Changes a playbook and saves it as a new version.',
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

  @ApiTags('Skills')
  @ApiOperation({
    summary: 'Delete a skill',
    description: 'Removes a playbook from a bot.',
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
