import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ example: 'Sales team' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({ example: 'Finds leads and writes to them.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({
    description: 'Optional: how the bots should work together',
    example:
      'Prospector finds the lead first, then Sales Bot writes the email.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  instructions?: string;

  @ApiProperty({
    description: 'Your bots in this group (2 to 6)',
    type: [String],
    example: [
      '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
      '7d0ad96f-7aae-4ca4-86fd-933f1a45603f',
    ],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsString({ each: true })
  botIds: string[];
}

export class UpdateGroupDto {
  @ApiPropertyOptional({ example: 'Sales team' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: 'Finds leads and writes to them.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({
    example:
      'Prospector finds the lead first, then Sales Bot writes the email.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  instructions?: string;

  @ApiPropertyOptional({
    description: 'Replaces the list of bots (2 to 6)',
    type: [String],
    example: [
      '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
      '7d0ad96f-7aae-4ca4-86fd-933f1a45603f',
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsString({ each: true })
  botIds?: string[];
}

export class ListGroupsQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100, example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'To load the next page, send the id of the last item you got',
    example: '9c1ad96f-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;
}

export class GroupBotDto {
  @ApiProperty({ example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: 'Sales Bot' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Writes and answers sales emails.',
  })
  description: string | null;
}

export class GroupDto {
  @ApiProperty({ example: '9c1ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: 'Sales team' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Finds leads and writes to them.',
  })
  description: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example:
      'Prospector finds the lead first, then Sales Bot writes the email.',
  })
  instructions: string | null;

  @ApiProperty({ type: [GroupBotDto] })
  bots: GroupBotDto[];

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  updatedAt: Date;
}
