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
import { BotDto, CreateBotDto, ListBotsQueryDto, UpdateBotDto } from '@/dto';
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
    description: 'Creates a bot. Integrations are optional.',
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
}
