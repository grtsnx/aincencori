CREATE TABLE "emailOutbox" (
    "id" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastErrorCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "emailOutbox_status_availableAt_idx"
    ON "emailOutbox"("status", "availableAt");
CREATE INDEX "emailOutbox_status_lockedAt_idx"
    ON "emailOutbox"("status", "lockedAt");
