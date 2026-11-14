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
    description: 'Your label for it, like work-gmail',
    example: 'work-gmail',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(namePattern, { message: nameMessage })
  name: string;

  @ApiPropertyOptional({
    description:
      'Which app, from "List apps". Leave out (or "mcp") for your own MCP server',
    default: 'mcp',
    example: 'gmail',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  app?: string;

  @ApiPropertyOptional({
    description: "Your own MCP server's address (https). Only for app mcp",
    example: 'https://mcp.example.com/mcp',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  url?: string;

  @ApiPropertyOptional({
    description: 'Access token for your own MCP server, if it needs one',
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
    description: 'To load the next page, send the id of the last item you got',
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

  @ApiProperty({ example: 'work-gmail' })
  name: string;

  @ApiProperty({ description: 'The app, or mcp', example: 'gmail' })
  app: string;

  @ApiProperty({
    description: 'pending: sign in with "Connect". active: ready to use',
    enum: ['pending', 'active', 'error', 'revoked', 'unknown'],
    example: 'active',
  })
  status: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Only for your own MCP servers',
    example: null,
  })
  url: string | null;

  @ApiProperty({
    description: 'Whether a token is saved. The token itself is never shown',
    example: false,
  })
  hasToken: boolean;

  @ApiProperty({ example: true })
  enabled: boolean;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  updatedAt: Date;
}

export class IntegrationAppDto {
  @ApiProperty({ example: 'gmail' })
  slug: string;

  @ApiProperty({ example: 'Gmail' })
  name: string;

  @ApiProperty({
    description: 'oauth: the user signs in. none: an address is enough',
    enum: ['oauth', 'none'],
    example: 'oauth',
  })
  signIn: 'oauth' | 'none';
}

export class IntegrationConnectDto {
  @ApiProperty({
    description: 'Send the user here to sign in to the app',
    example: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=example',
  })
  authorizeUrl: string;
}

export class IntegrationToolDto {
  @ApiProperty({ example: 'create_issue' })
  name: string;

  @ApiProperty({ example: 'Create an issue in a repository.' })
  description: string;
}

// One MCP server from the public MCP registry that we can connect to.
export class McpCatalogServerDto {
  @ApiProperty({
    description: 'Its name in the registry',
    example: 'ai.smithery/smithery-ai-github',
  })
  server: string;

  @ApiProperty({ example: 'GitHub' })
  title: string;

  @ApiProperty({ example: 'Access the GitHub API: files, repos and search.' })
  description: string;

  @ApiProperty({ example: '1.0.0' })
  version: string;

  @ApiProperty({ example: 'https://server.smithery.ai/@smithery-ai/github/mcp' })
  url: string;

  @ApiProperty({ description: 'It needs an access token', example: true })
  needsToken: boolean;

  @ApiProperty({
    description: 'What the token is, in the server’s words',
    example: 'Bearer token for Smithery authentication',
    nullable: true,
  })
  tokenHint: string | null;

  @ApiProperty({ example: 'https://github.com', nullable: true })
  website: string | null;
}

export class McpCatalogPageDto {
  @ApiProperty({ type: [McpCatalogServerDto] })
  servers: McpCatalogServerDto[];

  @ApiProperty({
    description: 'Pass as cursor for the next page; null at the end',
    example: 'ai.smithery/smithery-ai-github:1.0.0',
    nullable: true,
  })
  nextCursor: string | null;
}

export class McpCatalogQueryDto {
  @ApiPropertyOptional({ description: 'Words to look for', example: 'github' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'From the last page',
    example: 'ai.smithery/smithery-ai-github:1.0.0',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  cursor?: string;
}

export class InstallMcpServerDto {
  @ApiProperty({
    description: 'Its name in the registry (from the catalog)',
    example: 'ai.smithery/smithery-ai-github',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  server: string;

  @ApiProperty({ description: 'Your label for it', example: 'github' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(namePattern, { message: nameMessage })
  name: string;

  @ApiPropertyOptional({
    description: 'Access token, when the server needs one',
    example: 'sm_9Wd2Hs7QmVr2NcY7pKs1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  token?: string;
}
