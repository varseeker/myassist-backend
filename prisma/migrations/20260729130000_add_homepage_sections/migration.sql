-- CreateEnum
CREATE TYPE "HomepageSectionKey" AS ENUM ('HERO', 'HIGHLIGHTS', 'FEATURES', 'PROJECTS', 'WORKFLOW', 'CLIENTS', 'CTA');

-- CreateTable
CREATE TABLE "homepage_sections" (
    "id" UUID NOT NULL,
    "key" "HomepageSectionKey" NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homepage_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "homepage_sections_key_key" ON "homepage_sections"("key");

-- CreateIndex
CREATE INDEX "homepage_sections_is_visible_sort_order_idx" ON "homepage_sections"("is_visible", "sort_order");
