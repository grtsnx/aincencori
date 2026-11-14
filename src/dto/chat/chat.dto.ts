import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ChatAttachmentDto {
  @ApiProperty({ enum: ['image', 'file'], example: 'image' })
  @IsIn(['image', 'file'])
  kind: 'image' | 'file';

  @ApiProperty({ example: 'receipt.png' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({
    description: 'The file as a data URL',
    example: 'data:image/png;base64,iVBORw0KGgo=',
  })
  @IsString()
  data_url: string;
}

export class ChatPollDto {
  @ApiPropertyOptional({
    description: 'Only replies after this time',
    example: '2026-11-13T09:30:00.000Z',
  })
  @IsOptional()
  @IsString()
  after?: string;
}

export class ChatActionDto {
  @ApiProperty({ example: 'open_organization' })
  @IsString()
  @MaxLength(100)
  type: string;

  @ApiPropertyOptional({ example: { slug: 'acme' } })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['agent', 'client'], example: 'agent' })
  @IsOptional()
  @IsIn(['agent', 'client'])
  handler?: 'agent' | 'client';

  @ApiPropertyOptional({ example: 'w_1' })
  @IsOptional()
  @IsString()
  widgetId?: string;

  @ApiPropertyOptional({ example: 'Open Acme' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

export class ChatApprovalDto {
  @ApiProperty({
    description: 'The signed state from the approval event',
    example: 'eyJzZXNzaW9uSWQiOiJzZXNfMSJ9.c2lnbmF0dXJl',
  })
  @IsString()
  state: string;

  @ApiProperty({
    description:
      'Decision for each tool call, by call id. remember: chat or always',
    example: { call_1: { approved: true, remember: 'chat' } },
  })
  @IsObject()
  decisions: Record<
    string,
    { approved: boolean; message?: string; remember?: 'chat' | 'always' }
  >;
}

// Send one of: a message (with attachments), a widget action, approval
// decisions, or a poll while a person handles the chat.
export class ChatRequestDto {
  @ApiPropertyOptional({
    description:
      'Chat with one of your bots. Leave out for the default assistant. ' +
      'Send it with every message of a bot chat',
    example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  botId?: string;

  @ApiPropertyOptional({
    description:
      'Chat with one of your groups of bots. Send it with every message of a group chat',
    example: '9c1ad96f-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupId?: string;

  @ApiPropertyOptional({
    description: 'Leave out to start a new chat',
    example: 'ses_3f9aB2xY7pLm1n',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sessionId?: string;

  @ApiPropertyOptional({ example: 'Which organizations am I in?' })
  @IsOptional()
  @IsString()
  @MaxLength(32_000)
  message?: string;

  @ApiPropertyOptional({
    description:
      'Reply to an earlier message of this chat (its id), like in WhatsApp',
    example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  replyTo?: string;

  @ApiPropertyOptional({ type: [ChatAttachmentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentDto)
  attachments?: ChatAttachmentDto[];

  @ApiPropertyOptional({ type: ChatPollDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatPollDto)
  poll?: ChatPollDto;

  @ApiPropertyOptional({ type: ChatActionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatActionDto)
  action?: ChatActionDto;

  @ApiPropertyOptional({ type: ChatApprovalDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatApprovalDto)
  approval?: ChatApprovalDto;
}

export class ChatSessionDto {
  @ApiProperty({ example: 'ses_3f9aB2xY7pLm1n' })
  id: string;

  @ApiProperty({ example: 'Which organizations am I in?' })
  title: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Set when a routine started this chat',
    example: null,
  })
  routineId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The bot this chat is with; null for the default assistant',
    example: null,
  })
  botId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The group of bots this chat is with, if any',
    example: null,
  })
  groupId: string | null;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-13T09:35:00.000Z' })
  updatedAt: Date;
}

export class ChatMessageDto {
  @ApiProperty({ example: 'msg_1' })
  id: string;

  @ApiProperty({ enum: ['user', 'human', 'agent'], example: 'human' })
  from: 'user' | 'human' | 'agent';

  @ApiProperty({ example: 'Hi Ada, I can help with that.' })
  text: string;

  @ApiProperty({ example: '2026-11-13T09:31:00.000Z' })
  at: string;
}

export class ChatHandoffDto {
  @ApiProperty({ example: 'The user asked for a person.' })
  reason: string;

  @ApiProperty({ example: '2026-11-13T09:30:30.000Z' })
  at: string;
}

export class ChatStatusDto {
  @ApiProperty({ enum: ['human', 'agent'], example: 'human' })
  handledBy: 'human' | 'agent';

  @ApiProperty({ type: ChatHandoffDto, nullable: true })
  handoff: ChatHandoffDto | null;

  @ApiProperty({ type: [ChatMessageDto] })
  messages: ChatMessageDto[];
}

export class ChatReplyDto {
  @ApiProperty({ example: 'Hi Ada, I can help with that.' })
  @IsString()
  @MaxLength(4_000)
  text: string;
}

export class ChatHistoryQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100, example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'To load the next page, send the id of the last item you got',
    example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;
}

export class ChatFileDto {
  @ApiProperty({ example: 'receipt.png' })
  name: string;

  @ApiProperty({ enum: ['image', 'file'], example: 'image' })
  kind: 'image' | 'file';

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'A private link to open the file, good for 15 minutes. Null when the file was not kept',
    example: 'https://files.example.com/chats/kq3F9aB2xY7pLm1n/receipt.png',
  })
  url: string | null;
}

// The message another one replies to, shortened for the quote bubble.
export class ChatQuoteDto {
  @ApiProperty({ example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ enum: ['user', 'agent', 'human'], example: 'user' })
  role: 'user' | 'agent' | 'human';

  @ApiProperty({ type: String, nullable: true, example: null })
  agent: string | null;

  @ApiProperty({
    description: 'The start of its text',
    example: 'Can you check the Acme invoice?',
  })
  text: string;
}

export class ChatHistoryMessageDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ enum: ['user', 'agent', 'human'], example: 'agent' })
  role: 'user' | 'agent' | 'human';

  @ApiProperty({ type: String, nullable: true, example: 'Agentic' })
  agent: string | null;

  @ApiProperty({ example: 'You are in Acme.' })
  text: string;

  @ApiProperty({
    description: 'Widgets the agent showed',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    example: [
      {
        type: 'Card',
        title: 'Acme',
        children: [{ type: 'Text', value: 'You are the owner.' }],
      },
    ],
  })
  widgets: Record<string, unknown>[];

  @ApiProperty({
    description: 'Files the user attached',
    type: [ChatFileDto],
  })
  attachments: ChatFileDto[];

  @ApiProperty({
    type: ChatQuoteDto,
    nullable: true,
    description: 'The message this one replies to',
  })
  replyTo: ChatQuoteDto | null;

  @ApiProperty({
    type: [String],
    description: 'Next steps the agent offered, shown as buttons',
    example: ['Make it shorter'],
  })
  followUps: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Your emoji reaction',
    example: '👍',
  })
  reaction: string | null;

  @ApiProperty({ example: '2026-11-13T09:31:00.000Z' })
  createdAt: Date;
}

export class ReactDto {
  @ApiProperty({
    description: 'One emoji. Null removes your reaction',
    example: '👍',
    nullable: true,
    type: String,
  })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(32)
  @Matches(
    /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f)+$/u,
    {
      message: 'emoji must be one emoji',
    },
  )
  emoji: string | null;
}
