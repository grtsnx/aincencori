-- CreateTable
CREATE TABLE "chatSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chatSession_userId_updatedAt_idx" ON "chatSession"("userId", "updatedAt");
