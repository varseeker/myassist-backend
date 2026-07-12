-- AlterTable: add username (nullable first for backfill)
ALTER TABLE "users" ADD COLUMN "username" TEXT;

-- Backfill from email local-part; disambiguate duplicates
WITH ranked AS (
  SELECT
    id,
    lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9._]', '', 'g')) AS base_username,
    ROW_NUMBER() OVER (
      PARTITION BY lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9._]', '', 'g'))
      ORDER BY created_at
    ) AS rn
  FROM "users"
)
UPDATE "users" u
SET "username" = CASE
  WHEN r.base_username = '' THEN 'user' || substr(replace(u.id::text, '-', ''), 1, 8)
  WHEN r.rn = 1 THEN r.base_username
  ELSE r.base_username || r.rn::text
END
FROM ranked r
WHERE u.id = r.id;

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE INDEX "users_username_idx" ON "users"("username");
