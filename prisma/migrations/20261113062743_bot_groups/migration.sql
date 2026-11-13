-- AlterTable
ALTER TABLE "chatSession" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "botGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "botGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groupMember" (
    "groupId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,

    CONSTRAINT "groupMember_pkey" PRIMARY KEY ("groupId","botId")
);

-- CreateIndex
CREATE INDEX "botGroup_userId_createdAt_idx" ON "botGroup"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "groupMember_botId_idx" ON "groupMember"("botId");

-- AddForeignKey
ALTER TABLE "groupMember" ADD CONSTRAINT "groupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "botGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groupMember" ADD CONSTRAINT "groupMember_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
