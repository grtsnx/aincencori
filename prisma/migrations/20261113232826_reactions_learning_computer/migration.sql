-- AlterTable
ALTER TABLE "chatMessage" ADD COLUMN     "followUps" JSONB;

-- AlterTable
ALTER TABLE "chatSession" ADD COLUMN     "learnedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "messageReaction" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messageReaction_pkey" PRIMARY KEY ("messageId","userId")
);

-- CreateTable
CREATE TABLE "botSuggestion" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "instructions" TEXT,
    "skill" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "botSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agentComputer" (
    "userId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agentComputer_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "botSuggestion_botId_status_createdAt_idx" ON "botSuggestion"("botId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agentComputer_machineId_key" ON "agentComputer"("machineId");

-- AddForeignKey
ALTER TABLE "messageReaction" ADD CONSTRAINT "messageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botSuggestion" ADD CONSTRAINT "botSuggestion_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
