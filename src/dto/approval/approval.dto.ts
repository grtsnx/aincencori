import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class ApprovalFieldDto {
  @ApiProperty({ example: 'When' })
  label: string;

  @ApiProperty({ example: 'Every day at 08:00' })
  value: string;
}

// The fixed card every app shows for a waiting step. Written by our server
// from the step's real values, never by the AI.
export class ApprovalCardDto {
  @ApiProperty({ example: 'Create a routine' })
  title: string;

  @ApiProperty({
    example: '"Water" runs every day at 08:00 (Africa/Lagos).',
  })
  summary: string;

  @ApiProperty({ type: [ApprovalFieldDto] })
  fields: ApprovalFieldDto[];
}

export class PendingApprovalItemDto {
  @ApiProperty({ example: 'call_1' })
  callId: string;

  @ApiProperty({ example: 'create_routine' })
  toolName: string;

  @ApiProperty({
    description: 'What the AI wants to send, as JSON text',
    example: '{"name":"Morning news","cron":"0 8 * * *"}',
  })
  arguments: string;

  @ApiPropertyOptional({ example: 'Agentic' })
  agentName?: string;

  @ApiProperty({ type: ApprovalCardDto })
  card: ApprovalCardDto;
}

export class PendingApprovalDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ description: 'The chat to continue', example: 'ses_123' })
  chatId: string;

  @ApiPropertyOptional({
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
    nullable: true,
  })
  botId: string | null;

  @ApiProperty({
    enum: ['chat', 'routine', 'plan', 'app'],
    example: 'routine',
    description:
      'app: a step in a connected app (Gmail...); answer it here, not in a chat',
  })
  source: string;

  @ApiProperty({ type: [PendingApprovalItemDto] })
  items: PendingApprovalItemDto[];

  @ApiProperty({
    description: 'Send back to the chat with your decisions',
    example: 'eyJzZXNzaW9uSWQiOiJzZXNfMSJ9.c2lnbmF0dXJl',
  })
  state: string;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;
}

export const toolDecisions = ['allow', 'ask', 'deny'] as const;

export class ToolRuleDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: 'create_routine' })
  tool: string;

  @ApiPropertyOptional({
    description: 'Only in this bot’s chats',
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
    nullable: true,
  })
  botId: string | null;

  @ApiPropertyOptional({
    description: 'Only in this chat',
    example: 'ses_123',
    nullable: true,
  })
  chatId: string | null;

  @ApiProperty({ enum: toolDecisions, example: 'allow' })
  decision: string;

  @ApiPropertyOptional({
    example: '2026-11-20T09:30:00.000Z',
    nullable: true,
  })
  expiresAt: Date | null;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;
}

export class SetToolRuleDto {
  @ApiProperty({ example: 'create_routine' })
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]{1,128}$/)
  tool: string;

  @ApiProperty({ enum: toolDecisions, example: 'allow' })
  @IsIn(toolDecisions)
  decision: (typeof toolDecisions)[number];

  @ApiPropertyOptional({
    description: 'Only in this bot’s chats. Empty: everywhere',
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  botId?: string;
}

export class ToolInfoDto {
  @ApiProperty({ example: 'create_routine' })
  tool: string;

  @ApiProperty({ example: 'Create a scheduled task.' })
  description: string;
}

// The user's answer to a waiting app step (source "app").
export class AnswerApprovalDto {
  @ApiProperty({ example: true, description: 'true runs the step' })
  @IsBoolean()
  approved: boolean;

  @ApiPropertyOptional({
    enum: ['chat', 'always'],
    example: 'chat',
    description: 'Remember the answer: for this chat (a week), or always',
  })
  @IsOptional()
  @IsIn(['chat', 'always'])
  remember?: 'chat' | 'always';
}
