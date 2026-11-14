
-- AlterTable
ALTER TABLE "bot" ADD COLUMN     "hiredListingId" TEXT,
ADD COLUMN     "hiredUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "listing" ADD COLUMN     "hireCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "priceType" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN     "priceUsd" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "creatorAccount" (
    "userId" TEXT NOT NULL,
    "bachsAccountId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "payoutsActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creatorAccount_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "hire" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "botId" TEXT,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "platformFee" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "paidUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "creatorAccount_bachsAccountId_key" ON "creatorAccount"("bachsAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "hire_checkoutId_key" ON "hire"("checkoutId");

-- CreateIndex
CREATE INDEX "hire_buyerId_createdAt_idx" ON "hire"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "hire_creatorId_createdAt_idx" ON "hire"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "hire_listingId_idx" ON "hire"("listingId");
