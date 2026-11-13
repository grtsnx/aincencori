import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePlanDto {
  @ApiProperty({
    description: 'A big goal, in plain words',
    example:
      'Research three CRM tools for a small team, compare prices and write me a short report.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  goal: string;

  @ApiPropertyOptional({
    description: 'The bot that does the work. Empty: the default assistant',
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  botId?: string;
}

export class ListPlansQueryDto {
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

export class PlanStepDto {
  @ApiProperty({ description: 'Order, from 1', example: 1 })
  position: number;

  @ApiProperty({ example: 'Find three CRM tools' })
  title: string;

  @ApiProperty({
    example: 'Search the web for three popular CRM tools for small teams.',
  })
  instructions: string;

  @ApiProperty({
    description: 'waiting, running, done, failed or needs-approval',
    example: 'done',
  })
  status: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'What the step found or made',
    example: 'HubSpot, Pipedrive and Zoho CRM.',
  })
  result: string | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    example: '2026-11-13T09:30:00.000Z',
  })
  startedAt: Date | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    example: '2026-11-13T09:30:20.000Z',
  })
  finishedAt: Date | null;
}

export class PlanDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({
    example:
      'Research three CRM tools for a small team, compare prices and write me a short report.',
  })
  goal: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The bot doing the work. Empty: the default assistant',
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
  })
  botId: string | null;

  @ApiProperty({
    description: 'planning, running, done, failed, stopped or needs-approval',
    example: 'running',
  })
  status: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The chat with all the work, once it starts',
    example: 'sess_8f1c2a',
  })
  chatId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The final answer when done, or why it stopped',
    example: 'Pipedrive is the best fit: simple and $14 a month.',
  })
  summary: string | null;

  @ApiProperty({ type: [PlanStepDto] })
  steps: PlanStepDto[];

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-13T09:32:00.000Z' })
  updatedAt: Date;
}
