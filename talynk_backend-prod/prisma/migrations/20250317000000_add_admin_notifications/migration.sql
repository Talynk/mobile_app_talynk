-- CreateEnum
CREATE TYPE "AdminNotificationSeverity" AS ENUM ('info', 'warning', 'critical', 'action_required');

-- CreateTable
CREATE TABLE "admin_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "severity" "AdminNotificationSeverity" NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "message" TEXT NOT NULL,
    "actionUrl" VARCHAR(500),
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "consolidatedCount" INTEGER NOT NULL DEFAULT 1,
    "consolidatedKey" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_notifications_severity_idx" ON "admin_notifications"("severity");

-- CreateIndex
CREATE INDEX "admin_notifications_category_idx" ON "admin_notifications"("category");

-- CreateIndex
CREATE INDEX "admin_notifications_createdAt_idx" ON "admin_notifications"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "admin_notifications_readAt_idx" ON "admin_notifications"("readAt");

-- CreateIndex
CREATE INDEX "admin_notifications_consolidatedKey_createdAt_idx" ON "admin_notifications"("consolidatedKey", "createdAt" DESC);
