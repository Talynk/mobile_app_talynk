-- AlterTable: add HLS and thumbnail columns to posts
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "hls_url" VARCHAR(500);
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "thumbnail_url" VARCHAR(500);
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "video_duration" INTEGER;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "video_width" INTEGER;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "video_height" INTEGER;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "processing_status" VARCHAR(50);
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "processing_error" TEXT;
