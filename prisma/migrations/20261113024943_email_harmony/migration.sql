-- AlterTable
ALTER TABLE "user" ADD COLUMN     "normalizedEmail" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_normalizedEmail_key" ON "user"("normalizedEmail");

