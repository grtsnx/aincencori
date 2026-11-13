-- AlterTable
ALTER TABLE "chatSession" ADD COLUMN     "botId" TEXT;

-- AlterTable
ALTER TABLE "integration" ADD COLUMN     "app" TEXT NOT NULL DEFAULT 'mcp',
ADD COLUMN     "connectionId" TEXT,
ALTER COLUMN "url" DROP NOT NULL;

-- CreateTable
CREATE TABLE "agentWorkspace" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agentWorkspace_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "bot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cencoriAgentId" TEXT,
    "installationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "botIntegration" (
    "botId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,

    CONSTRAINT "botIntegration_pkey" PRIMARY KEY ("botId","integrationId")
);

-- CreateIndex
CREATE INDEX "bot_userId_createdAt_idx" ON "bot"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "botIntegration_integrationId_idx" ON "botIntegration"("integrationId");

-- AddForeignKey
ALTER TABLE "botIntegration" ADD CONSTRAINT "botIntegration_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botIntegration" ADD CONSTRAINT "botIntegration_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
