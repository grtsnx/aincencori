import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const namePattern = /^[a-z0-9][a-z0-9-]*$/;
const nameMessage = 'name: use lowercase letters, numbers and dashes';

export class CreateIntegrationDto {
  @ApiProperty({
    description: 'Short name; goes in front of the tool names',
    example: 'github',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(namePattern, { message: nameMessage })
  name: string;

  @ApiProperty({
    description: "The MCP server's address (https)",
    example: 'https://mcp.example.com/mcp',
  })
  @IsString()
  @MaxLength(2_000)
  url: string;

  @ApiPropertyOptional({
    description: 'Access token for the server, if it needs one',
    example: 'ghp_9Wd2Hs7QmVr2NcY7pKs1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  token?: string;

  @ApiPropertyOptional({ default: true, example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateIntegrationDto {
  @ApiPropertyOptional({ example: 'github' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(namePattern, { message: nameMessage })
  name?: string;

  @ApiPropertyOptional({ example: 'https://mcp.example.com/mcp' })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  url?: string;

  @ApiPropertyOptional({
    description: 'A new access token; an empty string removes it',
    example: 'ghp_9Wd2Hs7QmVr2NcY7pKs1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  token?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ListIntegrationsQueryDto {
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

export class IntegrationDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: 'github' })
  name: string;

  @ApiProperty({ example: 'https://mcp.example.com/mcp' })
  url: string;

  @ApiProperty({
    description: 'Whether a token is saved. The token itself is never shown',
    example: true,
  })
  hasToken: boolean;

  @ApiProperty({ example: true })
  enabled: boolean;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  updatedAt: Date;
}

export class IntegrationToolDto {
  @ApiProperty({ example: 'create_issue' })
  name: string;

  @ApiProperty({ example: 'Create an issue in a repository.' })
  description: string;
}
