-- AlterTable
ALTER TABLE "chatSession" ADD COLUMN     "routineId" TEXT;

-- CreateTable
CREATE TABLE "routine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "routine_userId_createdAt_idx" ON "routine"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "chatSession_routineId_createdAt_idx" ON "chatSession"("routineId", "createdAt");
