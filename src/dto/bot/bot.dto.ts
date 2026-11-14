import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateBotDto {
  @ApiProperty({ example: 'Sales Bot' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({
    description:
      'One line on what it is for. With it, the default assistant can hand chats to this bot',
    example: 'Answers sales emails and follows up with leads.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiProperty({
    description: 'How the bot should behave',
    example: 'You help me answer sales emails. Be short and friendly.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  instructions: string;

  @ApiPropertyOptional({
    description: 'Optional: your integrations this bot may use',
    type: [String],
    example: ['7d0ad96f-7aae-4ca4-86fd-933f1a45603f'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  integrationIds?: string[];

  @ApiPropertyOptional({
    description: 'Optional: your documents this bot may search',
    type: [String],
    example: ['5b1e0c4a-1f7e-4c55-9d1a-2f3c4d5e6f70'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  documentIds?: string[];

  @ApiPropertyOptional({ default: true, example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateBotDto {
  @ApiPropertyOptional({ example: 'Sales Bot' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({
    example: 'Answers sales emails and follows up with leads.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({
    example: 'You help me answer sales emails. Be short and friendly.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  instructions?: string;

  @ApiPropertyOptional({
    description: 'Replaces the list. An empty list removes them all',
    type: [String],
    example: ['7d0ad96f-7aae-4ca4-86fd-933f1a45603f'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  integrationIds?: string[];

  @ApiPropertyOptional({
    description: 'Replaces the document list. An empty list removes them all',
    type: [String],
    example: ['5b1e0c4a-1f7e-4c55-9d1a-2f3c4d5e6f70'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  documentIds?: string[];

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ListBotsQueryDto {
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

export class BotIntegrationDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: 'work-gmail' })
  name: string;

  @ApiProperty({ example: 'gmail' })
  app: string;
}

export class BotDocumentDto {
  @ApiProperty({ example: '5b1e0c4a-1f7e-4c55-9d1a-2f3c4d5e6f70' })
  id: string;

  @ApiProperty({ example: 'Refund policy.pdf' })
  name: string;
}

export class BotDto {
  @ApiProperty({ example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: 'Sales Bot' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Answers sales emails and follows up with leads.',
  })
  description: string | null;

  @ApiProperty({
    example: 'You help me answer sales emails. Be short and friendly.',
  })
  instructions: string;

  @ApiProperty({ example: true })
  enabled: boolean;

  @ApiProperty({
    description: 'Integrations this bot may use. Can be empty',
    type: [BotIntegrationDto],
  })
  integrations: BotIntegrationDto[];

  @ApiProperty({
    description: 'Documents this bot may search. Can be empty',
    type: [BotDocumentDto],
  })
  documents: BotDocumentDto[];

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  updatedAt: Date;
}

export class CreateBotMemoryDto {
  @ApiProperty({
    description: 'A fact the bot should know',
    example: 'My company is Acme and we sell accounting software.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text: string;
}

export class BotMemoryDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({
    example: 'My company is Acme and we sell accounting software.',
  })
  text: string;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;
}

export class CreateBotSkillDto {
  @ApiProperty({ example: 'follow-up-email' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @ApiProperty({
    description: 'When the bot should use it',
    example: 'Write a follow-up email after a sales call.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description: string;

  @ApiProperty({
    description: 'The steps to follow',
    example:
      '1. Thank them for the call.\n2. Sum up what was agreed.\n3. Ask for a next meeting.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  instructions: string;
}

export class UpdateBotSkillDto {
  @ApiPropertyOptional({ example: 'follow-up-email' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({
    example: 'Write a follow-up email after a sales call.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({
    example: '1. Thank them for the call.\n2. Ask for a next meeting.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  instructions?: string;
}

export class BotSkillDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: 'follow-up-email' })
  name: string;

  @ApiProperty({ example: 'Write a follow-up email after a sales call.' })
  description: string;

  @ApiProperty({
    example:
      '1. Thank them for the call.\n2. Sum up what was agreed.\n3. Ask for a next meeting.',
  })
  instructions: string;

  @ApiProperty({ description: 'Goes up with every change', example: 1 })
  version: number;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  updatedAt: Date;
}

export class SuggestedSkillDto {
  @ApiProperty({ example: 'weekly-report' })
  name: string;

  @ApiProperty({ example: 'Write the Friday sales report.' })
  description: string;

  @ApiProperty({
    example: '1. Pull this week’s deals.\n2. Group them by owner.',
  })
  instructions: string;
}

// A change a bot suggests to itself after learning from its chats.
export class BotSuggestionDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ enum: ['instructions', 'skill'], example: 'skill' })
  kind: string;

  @ApiProperty({ example: 'Add a weekly report skill' })
  title: string;

  @ApiProperty({
    description: 'What in the chats shows the need',
    example: 'You asked for the Friday report three times this month.',
  })
  reason: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'For instructions: the full new instructions',
    example: null,
  })
  instructions: string | null;

  @ApiProperty({ type: SuggestedSkillDto, nullable: true })
  skill: SuggestedSkillDto | null;

  @ApiProperty({
    enum: ['pending', 'accepted', 'dismissed'],
    example: 'pending',
  })
  status: string;

  @ApiProperty({ example: '2026-11-14T09:30:00.000Z' })
  createdAt: Date;
}
