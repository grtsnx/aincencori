import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

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

  @ApiProperty({ enum: ['chat', 'routine', 'plan'], example: 'routine' })
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
