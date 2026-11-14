import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ComputerDto {
  @ApiProperty({
    description: 'False when this server has no InstaBox key',
    example: true,
  })
  available: boolean;

  @ApiProperty({
    description: 'True once your agents have made it',
    example: true,
  })
  created: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-14T09:00:00.000Z',
  })
  createdAt: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-14T09:30:00.000Z',
  })
  lastUsedAt: Date | null;
}

export class ComputerFilesQueryDto {
  @ApiPropertyOptional({
    description: 'A folder or file. Default: your home folder',
    example: '/data/home',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  path?: string;
}

export class ComputerFileEntryDto {
  @ApiProperty({ example: 'report.md' })
  name: string;

  @ApiProperty({ enum: ['dir', 'file', 'symlink', 'other'], example: 'file' })
  type: string;

  @ApiProperty({ example: 2048 })
  size: number;
}

export class ComputerFilesDto {
  @ApiProperty({ example: '/data/home' })
  path: string;

  @ApiProperty({ enum: ['dir', 'file', 'other'], example: 'dir' })
  type: string;

  @ApiProperty({
    type: [ComputerFileEntryDto],
    description: 'A folder’s files',
  })
  entries: ComputerFileEntryDto[];

  @ApiPropertyOptional({
    description: 'A text file’s content',
    example: '# Report',
  })
  content?: string;

  @ApiProperty({
    description: 'More than could be shown',
    example: false,
  })
  truncated: boolean;
}
