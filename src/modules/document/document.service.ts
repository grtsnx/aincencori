import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  deleteFilesJob,
  indexDocumentJob,
  userKnowledgePrefix,
} from '@/config/agents/jobs.js';
import {
  documentChunkChars,
  documentSearchResults,
  maxDocumentBytes,
  maxDocumentChunks,
  maxDocumentsPerUser,
} from '@/config/agents/limits.js';
import type {
  CreateDocumentDto,
  DocumentDetailsDto,
  DocumentDto,
  DocumentHitDto,
  ListDocumentsQueryDto,
  SearchDocumentsQueryDto,
} from '@/dto';
import { type Document, Prisma } from '@/generated/prisma/client.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { R2Service } from '@/lib/r2/r2.service.js';
import {
  documentType,
  readDocumentText,
  serializableTransaction,
  splitText,
  UnreadableDocumentError,
} from '@/middleware';
import { ChatService } from '../chat/chat.service.js';

interface Owner {
  user: { id: string };
}

// Tries a job gets before a document is marked failed (see BullmqService).
const indexAttempts = 5;

// Knowledge: files a user adds (PDF, Word, text...) so their bots can look
// things up in them. The original file is kept in storage. A worker reads
// its text, splits it into pieces and stores them in Postgres, which
// searches them by word (its built-in text search: free, fast, and ours).
// Each bot searches only the documents its owner picked; the default
// assistant can search all of them.
@Injectable()
export class DocumentService implements OnModuleInit {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly bullmq: BullmqService,
    private readonly chat: ChatService,
  ) {}

  onModuleInit(): void {
    this.chat.useDocuments((userId, query) => this.searchText(userId, query));
    this.bullmq.handle<{ documentId: string }>(
      indexDocumentJob,
      ({ documentId }, { attempt }) => this.index(documentId, attempt),
    );
  }

  async list(
    auth: Owner,
    query: ListDocumentsQueryDto,
  ): Promise<DocumentDto[]> {
    const documents = await this.prisma.db.document.findMany({
      where: { userId: auth.user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
    return documents.map(toDto);
  }

  async get(id: string, auth: Owner): Promise<DocumentDetailsDto> {
    const document = await this.own(id, auth.user.id);
    return {
      ...toDto(document),
      url: await this.r2.link(document.key, {
        name: document.name,
        contentType: document.contentType,
      }),
    };
  }

  // Keeps the file and queues the reading. The document is "processing"
  // until a worker has read it (a few seconds), then "ready" or "failed".
  async create(auth: Owner, body: CreateDocumentDto): Promise<DocumentDto> {
    const userId = auth.user.id;
    const { bytes, type } = this.decode(body);
    const db = this.prisma.db;
    const id = randomUUID();
    const safeName = body.name.replace(/[^\w.-]+/g, '_').slice(-100);
    const key = `${userKnowledgePrefix(userId)}${id}/${safeName || 'document'}`;
    await this.r2.put(key, bytes, type);
    let document: Document;
    try {
      document = await serializableTransaction(db, async (tx) => {
        const count = await tx.document.count({ where: { userId } });
        if (count >= maxDocumentsPerUser) {
          throw new BadRequestException(
            `You can keep up to ${maxDocumentsPerUser} documents.`,
          );
        }
        return tx.document.create({
          data: {
            id,
            userId,
            name: body.name,
            contentType: type,
            size: bytes.length,
            key,
          },
        });
      });
    } catch (error) {
      await this.r2.remove([key]).catch(() => undefined);
      throw error;
    }
    try {
      await this.bullmq.add(
        indexDocumentJob,
        { documentId: id },
        { jobId: `index-${id}`, attempts: indexAttempts },
      );
    } catch (error) {
      // Not queued: don't leave a document that stays "processing" forever.
      await db.document.delete({ where: { id } }).catch(() => undefined);
      await this.r2.remove([key]).catch(() => undefined);
      throw error;
    }
    // Tests read it at once, so show the latest state.
    return toDto((await db.document.findUnique({ where: { id } })) ?? document);
  }

  async remove(id: string, auth: Owner): Promise<void> {
    const document = await this.own(id, auth.user.id);
    // Its text and bot links go with it.
    await this.prisma.db.document.delete({ where: { id } });
    await this.bullmq
      .add(deleteFilesJob, { keys: [document.key] })
      .catch(() => this.logger.warn(`File of document ${id} was not removed.`));
  }

  async search(
    auth: Owner,
    query: SearchDocumentsQueryDto,
  ): Promise<DocumentHitDto[]> {
    const userId = auth.user.id;
    if (!query.botId) return this.find(userId, query.q);
    const bot = await this.prisma.db.bot.findFirst({
      where: { id: query.botId, userId },
      select: { documents: { select: { documentId: true } } },
    });
    if (!bot) throw new NotFoundException('Bot not found.');
    return this.find(
      userId,
      query.q,
      bot.documents.map((link) => link.documentId),
    );
  }

  // The same, as text an agent can read. documentIds limits it to those.
  async searchText(
    userId: string,
    query: string,
    documentIds?: string[],
  ): Promise<string> {
    const hits = await this.find(userId, query, documentIds);
    if (hits.length === 0) {
      return 'Nothing found in the documents. Try other key words.';
    }
    return hits
      .map((hit) => `From "${hit.documentName}":\n${hit.text}`)
      .join('\n\n---\n\n');
  }

  // The ids among these that are the user's own documents.
  async owned(userId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const documents = await this.prisma.db.document.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true },
    });
    return documents.map((document) => document.id);
  }

  // Best matches first. A piece matches when it has any of the words
  // (so a question still finds answers); more words rank higher.
  private async find(
    userId: string,
    text: string,
    documentIds?: string[],
  ): Promise<DocumentHitDto[]> {
    if (documentIds?.length === 0) return [];
    const onlyThese = documentIds
      ? Prisma.sql`AND c."documentId" = ANY(${documentIds})`
      : Prisma.empty;
    const rows = await this.prisma.db.$queryRaw<
      {
        documentId: string;
        documentName: string;
        text: string;
        score: number;
      }[]
    >`
      SELECT c."documentId", d."name" AS "documentName", c."text",
             ts_rank_cd(c."search", words.q) AS "score"
      FROM "documentChunk" c
      JOIN "document" d ON d."id" = c."documentId"
      CROSS JOIN (
        SELECT replace(plainto_tsquery('english', ${text})::text, '&', '|')::tsquery AS q
      ) words
      WHERE c."userId" = ${userId} AND c."search" @@ words.q ${onlyThese}
      ORDER BY "score" DESC
      LIMIT ${documentSearchResults}`;
    return rows.map((row) => ({ ...row, score: Number(row.score) }));
  }

  // Worker: reads a document and stores its text in pieces.
  private async index(documentId: string, attempt: number): Promise<void> {
    const db = this.prisma.db;
    const document = await db.document.findUnique({
      where: { id: documentId },
    });
    if (!document || document.status !== 'processing') return;
    try {
      const bytes = await this.r2.get(document.key);
      const text = await readDocumentText(bytes, document.contentType);
      const pieces = splitText(text, documentChunkChars);
      if (pieces.length > maxDocumentChunks) {
        throw new UnreadableDocumentError(
          'This document has too much text. Split it into smaller files.',
        );
      }
      await db.$transaction([
        // A retry starts clean.
        db.documentChunk.deleteMany({ where: { documentId } }),
        db.documentChunk.createMany({
          data: pieces.map((piece, position) => ({
            id: randomUUID(),
            documentId,
            userId: document.userId,
            position,
            text: piece,
          })),
        }),
        db.document.update({
          where: { id: documentId },
          data: { status: 'ready', error: null, chunkCount: pieces.length },
        }),
      ]);
    } catch (error) {
      const unreadable = error instanceof UnreadableDocumentError;
      // Other errors (storage or database away) are tried again, up to the
      // last try.
      if (!unreadable && attempt < indexAttempts) throw error;
      this.logger.warn(`Document ${documentId} could not be read.`);
      await db.document.updateMany({
        where: { id: documentId },
        data: {
          status: 'failed',
          error: unreadable
            ? error.message
            : 'This file could not be read. Please try again later.',
        },
      });
    }
  }

  // The file's bytes and the type we read it as.
  private decode(body: CreateDocumentDto): { bytes: Uint8Array; type: string } {
    if (body.text !== undefined && body.dataUrl !== undefined) {
      throw new BadRequestException('Send a file or text, not both.');
    }
    if (body.text !== undefined) {
      return { bytes: new TextEncoder().encode(body.text), type: 'text/plain' };
    }
    const parsed = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(
      body.dataUrl ?? '',
    );
    if (!parsed) throw new BadRequestException('Send a file or some text.');
    const type = documentType(parsed[1], body.name);
    if (!type) {
      throw new BadRequestException(
        'This file type is not supported. Use PDF, Word (.docx), text, Markdown, CSV, JSON or HTML.',
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = parsed[3]
        ? Buffer.from(parsed[4], 'base64')
        : Buffer.from(decodeURIComponent(parsed[4]));
    } catch {
      throw new BadRequestException('The file could not be decoded.');
    }
    if (bytes.length === 0) throw new BadRequestException('The file is empty.');
    if (bytes.length > maxDocumentBytes) {
      throw new BadRequestException('Files can be up to 10 MB.');
    }
    return { bytes, type };
  }

  private async own(id: string, userId: string): Promise<Document> {
    const document = await this.prisma.db.document.findUnique({
      where: { id },
    });
    if (!document || document.userId !== userId) {
      throw new NotFoundException('Document not found.');
    }
    return document;
  }
}

function toDto(document: Document): DocumentDto {
  return {
    id: document.id,
    name: document.name,
    contentType: document.contentType,
    size: document.size,
    status: document.status,
    error: document.error,
    chunkCount: document.chunkCount,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
