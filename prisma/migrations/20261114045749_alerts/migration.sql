
-- CreateTable
CREATE TABLE "alert" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_title_lastAt_idx" ON "alert"("title", "lastAt");

-- CreateIndex
CREATE INDEX "alert_lastAt_idx" ON "alert"("lastAt");

