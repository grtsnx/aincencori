-- CreateTable
CREATE TABLE "chatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "agent" TEXT,
    "text" TEXT NOT NULL,
    "widgets" JSONB,
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chatMessage_sessionId_createdAt_idx" ON "chatMessage"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "chatMessage" ADD CONSTRAINT "chatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
