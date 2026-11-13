import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CreateDocumentDto,
  DocumentDetailsDto,
  DocumentDto,
  DocumentHitDto,
  ListDocumentsQueryDto,
  SearchDocumentsQueryDto,
} from '@/dto';
import type { AuthSession } from '@/lib/better-auth/better-auth.service.js';
import { CurrentSession } from '@/middleware';
import { DocumentService } from './document.service.js';

@Controller({ path: 'documents', version: '1' })
@ApiTags('Knowledge')
@ApiCookieAuth()
@ApiNotFoundResponse({ description: 'Document not found' })
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @ApiOperation({
    summary: 'List documents',
    description: 'Lists the files in your knowledge, newest first.',
  })
  @ApiOkResponse({ type: [DocumentDto] })
  @Get()
  list(
    @CurrentSession() auth: AuthSession,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<DocumentDto[]> {
    return this.documentService.list(auth, query);
  }

  @ApiOperation({
    summary: 'Add a document',
    description: 'Adds a file or text. It is searchable within seconds.',
  })
  @ApiOkResponse({ type: DocumentDto })
  // Reading files is heavy work: a few uploads a minute per user.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  create(
    @CurrentSession() auth: AuthSession,
    @Body() body: CreateDocumentDto,
  ): Promise<DocumentDto> {
    return this.documentService.create(auth, body);
  }

  @ApiOperation({
    summary: 'Search documents',
    description: 'Finds the parts of your documents that match some words.',
  })
  @ApiOkResponse({ type: [DocumentHitDto] })
  @Get('search')
  search(
    @CurrentSession() auth: AuthSession,
    @Query() query: SearchDocumentsQueryDto,
  ): Promise<DocumentHitDto[]> {
    return this.documentService.search(auth, query);
  }

  @ApiOperation({
    summary: 'Get a document',
    description: 'Returns one document with a link to the file.',
  })
  @ApiOkResponse({ type: DocumentDetailsDto })
  @Get(':id')
  get(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<DocumentDetailsDto> {
    return this.documentService.get(id, auth);
  }

  @ApiOperation({
    summary: 'Delete a document',
    description: 'Deletes a document. Bots stop using it at once.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id') id: string,
    @CurrentSession() auth: AuthSession,
  ): Promise<void> {
    return this.documentService.remove(id, auth);
  }
}
