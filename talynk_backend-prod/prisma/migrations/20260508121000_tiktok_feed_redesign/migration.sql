-- AlterTable
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "impression_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "engagement_score" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "last_engagement_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "posts_impression_count_idx" ON "posts"("impression_count");
CREATE INDEX IF NOT EXISTS "posts_engagement_score_idx" ON "posts"("engagement_score" DESC);

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_creator_affinity" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "affinity_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interaction_count" INTEGER NOT NULL DEFAULT 0,
    "last_interaction" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_creator_affinity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_creator_affinity_user_id_creator_id_key" ON "user_creator_affinity"("user_id", "creator_id");
CREATE INDEX IF NOT EXISTS "user_creator_affinity_user_id_affinity_score_idx" ON "user_creator_affinity"("user_id", "affinity_score" DESC);

ALTER TABLE "user_creator_affinity" DROP CONSTRAINT IF EXISTS "user_creator_affinity_user_id_fkey";
ALTER TABLE "user_creator_affinity" ADD CONSTRAINT "user_creator_affinity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_creator_affinity" DROP CONSTRAINT IF EXISTS "user_creator_affinity_creator_id_fkey";
ALTER TABLE "user_creator_affinity" ADD CONSTRAINT "user_creator_affinity_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
