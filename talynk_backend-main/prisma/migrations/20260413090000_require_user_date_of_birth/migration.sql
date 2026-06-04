-- Backfill null DOB then enforce NOT NULL (legacy upgrade path; no-op on fresh DBs where init already set NOT NULL)
UPDATE "users"
SET "date_of_birth" = TIMESTAMP '2000-01-01 00:00:00'
WHERE "date_of_birth" IS NULL;

ALTER TABLE "users"
ALTER COLUMN "date_of_birth" SET NOT NULL;
