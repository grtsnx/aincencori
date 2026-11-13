import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateDocumentDto {
  @ApiProperty({ example: 'Refund policy.pdf' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    description:
      'The file as a data URL: PDF, Word (.docx), text, Markdown, CSV, JSON or HTML, up to 10 MB. Send this or text',
    example: 'data:text/plain;base64,UmVmdW5kcyB3aXRoaW4gMzAgZGF5cy4=',
  })
  @IsOptional()
  @IsString()
  @Matches(/^data:/, { message: 'dataUrl must be a data URL' })
  @MaxLength(14_000_000)
  dataUrl?: string;

  @ApiPropertyOptional({
    description: 'Plain text to keep as a document. Send this or dataUrl',
    example: 'Customers get a full refund within 30 days.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1_000_000)
  text?: string;
}

export class ListDocumentsQueryDto {
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

export class SearchDocumentsQueryDto {
  @ApiProperty({ description: 'What to look for', example: 'refund window' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  q: string;

  @ApiPropertyOptional({
    description: 'Only search the documents this bot may use',
    example: '3f9aB2xY-7aae-4ca4-86fd-933f1a45603f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  botId?: string;
}

export class DocumentDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  id: string;

  @ApiProperty({ example: 'Refund policy.pdf' })
  name: string;

  @ApiProperty({ example: 'application/pdf' })
  contentType: string;

  @ApiProperty({ description: 'Size in bytes', example: 48213 })
  size: number;

  @ApiProperty({
    description: 'processing, ready or failed',
    example: 'ready',
  })
  status: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why it failed. Empty when it did not',
    example: 'No text found. Is it a scanned PDF?',
  })
  error: string | null;

  @ApiProperty({ description: 'Searchable pieces of text', example: 12 })
  chunkCount: number;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-13T09:30:00.000Z' })
  updatedAt: Date;
}

export class DocumentDetailsDto extends DocumentDto {
  @ApiProperty({
    description: 'A private link to the file. It works for 15 minutes',
    example: 'https://files.example.com/knowledge/abc/refund-policy.pdf',
  })
  url: string;
}

export class DocumentHitDto {
  @ApiProperty({ example: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f' })
  documentId: string;

  @ApiProperty({ example: 'Refund policy.pdf' })
  documentName: string;

  @ApiProperty({
    description: 'The matching piece of text',
    example: 'Customers get a full refund within 30 days of purchase.',
  })
  text: string;

  @ApiProperty({ description: 'Higher is a better match', example: 0.42 })
  score: number;
}
