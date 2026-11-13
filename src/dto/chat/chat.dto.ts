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
  Max,
  MaxLength,
  Min,
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
    description: 'Decision for each tool call, by call id',
    example: { call_1: { approved: true } },
  })
  @IsObject()
  decisions: Record<string, { approved: boolean; message?: string }>;
}

// Send one of: a message (with attachments), a widget action, approval
// decisions, or a poll while a person handles the chat.
export class ChatRequestDto {
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
    description: 'For the next page: the id of the last item you have',
    example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;
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
    example: [{ type: 'Card', title: 'Acme', children: [] }],
  })
  widgets: Record<string, unknown>[];

  @ApiProperty({
    description: 'Names of attached files',
    type: [String],
    example: ['receipt.png'],
  })
  attachments: string[];

  @ApiProperty({ example: '2026-11-13T09:31:00.000Z' })
  createdAt: Date;
}
