import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { listingCategories } from '@/config/agents/limits.js';

export class PublishBotDto {
  @ApiProperty({
    description: 'The bot to share. It needs a description',
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsString()
  @MaxLength(200)
  botId: string;

  @ApiProperty({ enum: listingCategories, example: 'sales' })
  @IsIn(listingCategories)
  category: string;

  @ApiPropertyOptional({
    description: 'The name shown as the author. Default: your name',
    example: 'Ada at Acme',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  authorName?: string;
}

export class BrowseListingsQueryDto {
  @ApiPropertyOptional({
    description: 'Words to look for in the name or description',
    example: 'email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: listingCategories, example: 'sales' })
  @IsOptional()
  @IsIn(listingCategories)
  category?: string;

  @ApiPropertyOptional({
    enum: ['popular', 'newest'],
    default: 'popular',
    example: 'popular',
  })
  @IsOptional()
  @IsIn(['popular', 'newest'])
  sort?: 'popular' | 'newest';

  @ApiPropertyOptional({ default: 24, minimum: 1, maximum: 100, example: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'How many to skip, for the next page',
    default: 0,
    minimum: 0,
    maximum: 1000,
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  offset?: number;
}

export class ReviewListingsQueryDto {
  @ApiPropertyOptional({
    enum: ['reviewing', 'published', 'rejected'],
    default: 'reviewing',
    example: 'reviewing',
  })
  @IsOptional()
  @IsIn(['reviewing', 'published', 'rejected'])
  status?: 'reviewing' | 'published' | 'rejected';

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

export class RejectListingDto {
  @ApiProperty({
    description: 'Why, shown to the author',
    example: 'The instructions ask the bot to collect card numbers.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}

export class ListingSkillDto {
  @ApiProperty({ example: 'follow-up-email' })
  name: string;

  @ApiProperty({ example: 'Write a follow-up email after a sales call.' })
  description: string;

  @ApiProperty({
    example: '1. Thank them for the call.\n2. Ask for a next meeting.',
  })
  instructions: string;
}

export class ListingDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: 'Sales Bot' })
  name: string;

  @ApiProperty({ example: 'Answers sales emails and follows up with leads.' })
  description: string;

  @ApiProperty({ enum: listingCategories, example: 'sales' })
  category: string;

  @ApiProperty({ example: 'Ada at Acme' })
  authorName: string;

  @ApiProperty({
    description: 'What a copy of the bot is told to do',
    example: 'You help me answer sales emails. Be short and friendly.',
  })
  instructions: string;

  @ApiProperty({ type: [ListingSkillDto] })
  skills: ListingSkillDto[];

  @ApiProperty({ description: 'How many people copied it', example: 128 })
  importCount: number;

  @ApiProperty({
    type: Date,
    nullable: true,
    example: '2026-11-13T09:30:00.000Z',
  })
  publishedAt: Date | null;
}

export class OwnListingDto extends ListingDto {
  @ApiProperty({ example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f' })
  botId: string;

  @ApiProperty({
    description: 'reviewing, published or rejected',
    example: 'published',
  })
  status: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why it was rejected',
    example: 'The instructions ask the bot to collect card numbers.',
  })
  reviewNote: string | null;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  updatedAt: Date;
}
