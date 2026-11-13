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
    description: 'For the next page: the id of the last item you have',
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

export class BotDto {
  @ApiProperty({ example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: 'Sales Bot' })
  name: string;

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

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  updatedAt: Date;
}
