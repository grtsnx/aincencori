-- CreateTable
CREATE TABLE "agentHost" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "userId" TEXT,
    "defaultCapabilities" TEXT,
    "publicKey" TEXT,
    "kid" TEXT,
    "jwksUrl" TEXT,
    "enrollmentTokenHash" TEXT,
    "enrollmentTokenExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agentHost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "hostId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "mode" TEXT NOT NULL DEFAULT 'delegated',
    "publicKey" TEXT NOT NULL,
    "kid" TEXT,
    "jwksUrl" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agentCapabilityGrant" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "deniedBy" TEXT,
    "grantedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reason" TEXT,
    "constraints" TEXT,

    CONSTRAINT "agentCapabilityGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvalRequest" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "agentId" TEXT,
    "hostId" TEXT,
    "userId" TEXT,
    "capabilities" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "userCodeHash" TEXT,
    "loginHint" TEXT,
    "bindingMessage" TEXT,
    "clientNotificationToken" TEXT,
    "clientNotificationEndpoint" TEXT,
    "deliveryMode" TEXT,
    "interval" INTEGER NOT NULL,
    "lastPolledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approvalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agentHost_userId_idx" ON "agentHost"("userId");

-- CreateIndex
CREATE INDEX "agentHost_kid_idx" ON "agentHost"("kid");

-- CreateIndex
CREATE INDEX "agentHost_enrollmentTokenHash_idx" ON "agentHost"("enrollmentTokenHash");

-- CreateIndex
CREATE INDEX "agentHost_status_idx" ON "agentHost"("status");

-- CreateIndex
CREATE INDEX "agent_userId_idx" ON "agent"("userId");

-- CreateIndex
CREATE INDEX "agent_hostId_idx" ON "agent"("hostId");

-- CreateIndex
CREATE INDEX "agent_status_idx" ON "agent"("status");

-- CreateIndex
CREATE INDEX "agent_kid_idx" ON "agent"("kid");

-- CreateIndex
CREATE INDEX "agentCapabilityGrant_agentId_idx" ON "agentCapabilityGrant"("agentId");

-- CreateIndex
CREATE INDEX "agentCapabilityGrant_capability_idx" ON "agentCapabilityGrant"("capability");

-- CreateIndex
CREATE INDEX "agentCapabilityGrant_grantedBy_idx" ON "agentCapabilityGrant"("grantedBy");

-- CreateIndex
CREATE INDEX "agentCapabilityGrant_deniedBy_idx" ON "agentCapabilityGrant"("deniedBy");

-- CreateIndex
CREATE INDEX "agentCapabilityGrant_status_idx" ON "agentCapabilityGrant"("status");

-- CreateIndex
CREATE INDEX "approvalRequest_agentId_idx" ON "approvalRequest"("agentId");

-- CreateIndex
CREATE INDEX "approvalRequest_hostId_idx" ON "approvalRequest"("hostId");

-- CreateIndex
CREATE INDEX "approvalRequest_userId_idx" ON "approvalRequest"("userId");

-- CreateIndex
CREATE INDEX "approvalRequest_status_idx" ON "approvalRequest"("status");

-- AddForeignKey
ALTER TABLE "agentHost" ADD CONSTRAINT "agentHost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "agent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "agent_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "agentHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentCapabilityGrant" ADD CONSTRAINT "agentCapabilityGrant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentCapabilityGrant" ADD CONSTRAINT "agentCapabilityGrant_deniedBy_fkey" FOREIGN KEY ("deniedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentCapabilityGrant" ADD CONSTRAINT "agentCapabilityGrant_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvalRequest" ADD CONSTRAINT "approvalRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvalRequest" ADD CONSTRAINT "approvalRequest_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "agentHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvalRequest" ADD CONSTRAINT "approvalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
