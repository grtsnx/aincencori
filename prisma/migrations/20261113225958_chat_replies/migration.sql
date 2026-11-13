-- AlterTable
ALTER TABLE "chatMessage" ADD COLUMN     "replyToId" TEXT;

-- AddForeignKey
ALTER TABLE "chatMessage" ADD CONSTRAINT "chatMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "chatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
