-- CreateTable
CREATE TABLE "integration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "token" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_userId_createdAt_idx" ON "integration"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_userId_name_key" ON "integration"("userId", "name");
