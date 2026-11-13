-- AlterTable
ALTER TABLE "bot" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "routine" ADD COLUMN     "botId" TEXT;

-- CreateTable
CREATE TABLE "botMemory" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "botMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "botSkill" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "botSkill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "botMemory_botId_createdAt_idx" ON "botMemory"("botId", "createdAt");

-- CreateIndex
CREATE INDEX "botSkill_botId_createdAt_idx" ON "botSkill"("botId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "botSkill_botId_name_key" ON "botSkill"("botId", "name");

-- CreateIndex
CREATE INDEX "routine_botId_createdAt_idx" ON "routine"("botId", "createdAt");

-- AddForeignKey
ALTER TABLE "routine" ADD CONSTRAINT "routine_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botMemory" ADD CONSTRAINT "botMemory_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botSkill" ADD CONSTRAINT "botSkill_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
