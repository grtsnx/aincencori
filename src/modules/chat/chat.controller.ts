import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import {
  ChatHistoryMessageDto,
  ChatHistoryQueryDto,
  ChatMessageDto,
  ChatPollDto,
  ChatReplyDto,
  ChatRequestDto,
  ChatSessionDto,
  ChatStatusDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { ChatService } from './chat.service.js';

const streamExample =
  'event: agent\ndata: {"name":"Agentic"}\n\n' +
  'event: text\ndata: {"delta":"You are in Acme.","agent":"Agentic"}\n\n' +
  'event: done\ndata: {"sessionId":"ses_3f9aB2xY7pLm1n"}\n\n';

@Controller({ path: 'chat', version: '1' })
@ApiTags('Chat')
@ApiCookieAuth()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @ApiOperation({
    summary: 'Chat with agent',
    description:
      'Streams the answer: text, widgets, tools, approvals, handoffs.',
  })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: 'Server-sent events',
    content: {
      'text/event-stream': {
        schema: { type: 'string', example: streamExample },
      },
    },
  })
  @ApiForbiddenResponse({ description: 'This chat belongs to someone else' })
  @Post()
  @HttpCode(200)
  send(
    @Body() body: ChatRequestDto,
    @CurrentSession() auth: AuthSession,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.chatService.send(body, auth, request, response);
  }

  @ApiOperation({
    summary: 'List chats',
    description: 'Your chats, newest first. Page with "before".',
  })
  @ApiOkResponse({ type: [ChatSessionDto] })
  @Get()
  list(
    @CurrentSession() auth: AuthSession,
    @Query() query: ChatHistoryQueryDto,
  ): Promise<ChatSessionDto[]> {
    return this.chatService.list(auth, query);
  }

  @ApiOperation({
    summary: 'Delete a chat',
    description: 'Deletes one of your chats and its history.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @Delete(':sessionId')
  @HttpCode(204)
  remove(
    @Param('sessionId') sessionId: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<void> {
    return this.chatService.remove(sessionId, auth);
  }

  @ApiOperation({
    summary: 'Chat messages',
    description: 'Saved messages of one chat. Page with "before".',
  })
  @ApiOkResponse({ type: [ChatHistoryMessageDto] })
  @ApiForbiddenResponse({ description: 'Not allowed for this user' })
  @Get(':sessionId/messages')
  messages(
    @Param('sessionId') sessionId: string,
    @Query() query: ChatHistoryQueryDto,
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<ChatHistoryMessageDto[]> {
    return this.chatService.messages(sessionId, auth, headers, query);
  }

  @ApiOperation({
    summary: 'Chat handoff status',
    description: 'Who handles the chat, and messages from our team.',
  })
  @ApiOkResponse({ type: ChatStatusDto })
  @ApiForbiddenResponse({ description: 'Not allowed for this user' })
  @Get(':sessionId/status')
  status(
    @Param('sessionId') sessionId: string,
    @Query() query: ChatPollDto,
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<ChatStatusDto> {
    return this.chatService.status(sessionId, auth, headers, query.after);
  }

  @ApiOperation({
    summary: 'Reply as staff',
    description: 'Staff answer a chat the agent handed to a person.',
  })
  @ApiOkResponse({ type: ChatMessageDto })
  @ApiForbiddenResponse({ description: 'Not allowed for this user' })
  @Post(':sessionId/reply')
  @HttpCode(200)
  reply(
    @Param('sessionId') sessionId: string,
    @Body() body: ChatReplyDto,
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<ChatMessageDto> {
    return this.chatService.reply(sessionId, body.text, auth, headers);
  }

  @ApiOperation({
    summary: 'Hand back to agent',
    description: 'Staff give the chat back to the agent.',
  })
  @ApiNoContentResponse({ description: 'Handed back' })
  @ApiForbiddenResponse({ description: 'Not allowed for this user' })
  @Post(':sessionId/release')
  @HttpCode(204)
  release(
    @Param('sessionId') sessionId: string,
    @CurrentSession() auth: AuthSession,
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<void> {
    return this.chatService.release(sessionId, auth, headers);
  }
}
