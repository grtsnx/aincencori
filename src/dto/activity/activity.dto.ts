import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ActivityDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiPropertyOptional({
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
    nullable: true,
  })
  userId: string | null;

  @ApiProperty({
    description: 'user, staff:<id>, agent:<name> or system',
    example: 'user',
  })
  actor: string;

  @ApiProperty({ example: 'tool.ran' })
  action: string;

  @ApiPropertyOptional({ example: 'create_routine', nullable: true })
  target: string | null;

  @ApiPropertyOptional({
    example: 'Morning news, every day at 8',
    nullable: true,
  })
  detail: string | null;

  @ApiPropertyOptional({ example: '102.88.166.1', nullable: true })
  ip: string | null;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;
}

export class ListActivityQueryDto {
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

  @ApiPropertyOptional({
    description: 'Only this kind, like tool.ran',
    example: 'tool.ran',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;
}

export class AdminActivityQueryDto extends ListActivityQueryDto {
  @ApiPropertyOptional({
    description: 'Only this user',
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  userId?: string;
}
