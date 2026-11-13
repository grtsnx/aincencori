-- CreateTable
CREATE TABLE "usageDay" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "usageDay_pkey" PRIMARY KEY ("userId","day","kind")
);

-- CreateTable
CREATE TABLE "billingPlan" (
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "monthlyLimitUsd" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billingPlan_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "toolRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "botId" TEXT,
    "chatId" TEXT,
    "decision" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "toolRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pendingApproval" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "botId" TEXT,
    "source" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pendingApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usageDay_day_idx" ON "usageDay"("day");

-- CreateIndex
CREATE INDEX "toolRule_userId_tool_idx" ON "toolRule"("userId", "tool");

-- CreateIndex
CREATE INDEX "pendingApproval_userId_createdAt_idx" ON "pendingApproval"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "pendingApproval_chatId_idx" ON "pendingApproval"("chatId");

-- CreateIndex
CREATE INDEX "activityLog_userId_createdAt_idx" ON "activityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "activityLog_action_createdAt_idx" ON "activityLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "activityLog_createdAt_idx" ON "activityLog"("createdAt");
