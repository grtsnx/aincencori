-- Remove scheduled prompts when their owner is deleted.
ALTER TABLE "routine"
ADD CONSTRAINT "routine_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id")
ON DELETE CASCADE ON UPDATE CASCADE
NOT VALID;
