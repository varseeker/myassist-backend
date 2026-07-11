-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'USER_INPUT' BEFORE 'QA_REVIEW';

-- AlterTable
ALTER TABLE "tickets" ALTER COLUMN "sprint_id" DROP NOT NULL;
