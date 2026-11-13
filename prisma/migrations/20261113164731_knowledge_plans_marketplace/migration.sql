-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "error" TEXT,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    -- Filled in by Postgres from "text", so search always matches it.
    "search" tsvector GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED,

    CONSTRAINT "documentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "botDocument" (
    "botId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,

    CONSTRAINT "botDocument_pkey" PRIMARY KEY ("botId","documentId")
);

-- CreateTable
CREATE TABLE "plan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "chatId" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planStep" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "result" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "planStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "skills" JSONB NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reviewing',
    "reviewNote" TEXT,
    "importCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_userId_createdAt_idx" ON "document"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "documentChunk_documentId_position_idx" ON "documentChunk"("documentId", "position");

-- CreateIndex
CREATE INDEX "documentChunk_userId_idx" ON "documentChunk"("userId");

-- CreateIndex
CREATE INDEX "documentChunk_search_idx" ON "documentChunk" USING GIN ("search");

-- CreateIndex
CREATE INDEX "botDocument_documentId_idx" ON "botDocument"("documentId");

-- CreateIndex
CREATE INDEX "plan_userId_createdAt_idx" ON "plan"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "planStep_planId_position_key" ON "planStep"("planId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "listing_botId_key" ON "listing"("botId");

-- CreateIndex
CREATE INDEX "listing_status_importCount_idx" ON "listing"("status", "importCount");

-- CreateIndex
CREATE INDEX "listing_status_publishedAt_idx" ON "listing"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "listing_userId_idx" ON "listing"("userId");

-- AddForeignKey
ALTER TABLE "documentChunk" ADD CONSTRAINT "documentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botDocument" ADD CONSTRAINT "botDocument_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botDocument" ADD CONSTRAINT "botDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan" ADD CONSTRAINT "plan_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planStep" ADD CONSTRAINT "planStep_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing" ADD CONSTRAINT "listing_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
