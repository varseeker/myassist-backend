-- Make email optional (nullable) while keeping uniqueness for non-null values
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
