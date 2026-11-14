
-- AlterTable
ALTER TABLE "billingPlan" ADD COLUMN     "bachsCustomerId" TEXT,
ADD COLUMN     "bachsSubscriptionId" TEXT,
ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creditUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "paidUntil" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "trialUsedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "billingEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billingEvent_userId_createdAt_idx" ON "billingEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "billingPlan_bachsSubscriptionId_key" ON "billingPlan"("bachsSubscriptionId");


-- Plans set before payments were wired were set by staff.
UPDATE "billingPlan" SET "source" = 'staff' WHERE "plan" <> 'free';
