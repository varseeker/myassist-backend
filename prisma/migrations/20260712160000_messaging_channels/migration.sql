-- CreateEnum
CREATE TYPE "MessagingChannel" AS ENUM ('WHATSAPP_BAILEYS', 'TELEGRAM', 'WHATSAPP_META');

-- CreateEnum
CREATE TYPE "MessagingDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "phone_number" TEXT,
ADD COLUMN "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "telegram_chat_id" TEXT,
ADD COLUMN "telegram_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "telegram_link_token" TEXT;

-- AlterTable
ALTER TABLE "tickets"
ADD COLUMN "managed_by_id" UUID;

-- CreateTable
CREATE TABLE "messaging_delivery_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "channel" "MessagingChannel" NOT NULL,
    "status" "MessagingDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messaging_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_link_token_key" ON "users"("telegram_link_token");

-- CreateIndex
CREATE INDEX "users_phone_number_idx" ON "users"("phone_number");

-- CreateIndex
CREATE INDEX "users_telegram_chat_id_idx" ON "users"("telegram_chat_id");

-- CreateIndex
CREATE INDEX "tickets_managed_by_id_idx" ON "tickets"("managed_by_id");

-- CreateIndex
CREATE INDEX "messaging_delivery_logs_user_id_idx" ON "messaging_delivery_logs"("user_id");

-- CreateIndex
CREATE INDEX "messaging_delivery_logs_channel_idx" ON "messaging_delivery_logs"("channel");

-- CreateIndex
CREATE INDEX "messaging_delivery_logs_status_idx" ON "messaging_delivery_logs"("status");

-- CreateIndex
CREATE INDEX "messaging_delivery_logs_created_at_idx" ON "messaging_delivery_logs"("created_at");

-- AddForeignKey
ALTER TABLE "tickets"
ADD CONSTRAINT "tickets_managed_by_id_fkey"
FOREIGN KEY ("managed_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_delivery_logs"
ADD CONSTRAINT "messaging_delivery_logs_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
