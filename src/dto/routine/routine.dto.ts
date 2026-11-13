import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRoutineDto {
  @ApiProperty({ example: 'Morning news' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'What the agent is asked each time',
    example: 'Summarize the top 5 tech news stories of today.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  prompt: string;

  @ApiProperty({
    description:
      'When it runs, as a cron pattern (minute hour day month weekday)',
    example: '0 8 * * *',
  })
  @IsString()
  @MaxLength(100)
  cron: string;

  @ApiProperty({
    description: 'Time zone for the schedule',
    example: 'Africa/Lagos',
  })
  @IsString()
  @MaxLength(100)
  timezone: string;

  @ApiPropertyOptional({
    description: 'The bot that runs it. Leave out for the default assistant',
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  botId?: string;

  @ApiPropertyOptional({ default: true, example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateRoutineDto {
  @ApiPropertyOptional({ example: 'Morning news' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'Summarize the top 5 tech news stories of today.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  prompt?: string;

  @ApiPropertyOptional({ example: '30 7 * * 1-5' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cron?: string;

  @ApiPropertyOptional({ example: 'Europe/London' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ListRoutinesQueryDto {
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

  @ApiPropertyOptional({
    description: 'Only the routines of this bot',
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  botId?: string;
}

export class RoutineDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: 'Morning news' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The bot that runs it; null for the default assistant',
    example: null,
  })
  botId: string | null;

  @ApiProperty({ example: 'Summarize the top 5 tech news stories of today.' })
  prompt: string;

  @ApiProperty({ example: '0 8 * * *' })
  cron: string;

  @ApiProperty({ example: 'Africa/Lagos' })
  timezone: string;

  @ApiProperty({ example: true })
  enabled: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-14T08:00:00.000Z',
  })
  nextRunAt: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-13T08:00:00.000Z',
  })
  lastRunAt: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['ok', 'failed', 'needs-approval'],
    example: 'ok',
  })
  lastStatus: string | null;

  @ApiProperty({ example: '2026-11-13T07:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-13T07:00:00.000Z' })
  updatedAt: Date;
}
