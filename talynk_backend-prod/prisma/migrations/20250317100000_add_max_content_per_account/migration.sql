-- AlterTable
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'challenges'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'challenges'
      AND column_name = 'max_content_per_account'
  ) THEN
    ALTER TABLE "challenges" ADD COLUMN "max_content_per_account" INTEGER NOT NULL DEFAULT 5;
  END IF;
END $$;
