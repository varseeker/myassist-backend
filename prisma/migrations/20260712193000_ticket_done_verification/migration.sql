-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'DONE' BEFORE 'RESOLVED';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "verification_user_id" UUID;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tickets_verification_user_id_idx" ON "tickets"("verification_user_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tickets_verification_user_id_fkey'
  ) THEN
    ALTER TABLE "tickets"
      ADD CONSTRAINT "tickets_verification_user_id_fkey"
      FOREIGN KEY ("verification_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;