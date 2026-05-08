-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."PostStatus" AS ENUM ('draft', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "public"."CategoryStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "public"."ReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'INAPPROPRIATE_CONTENT', 'COPYRIGHT_VIOLATION', 'FALSE_INFORMATION', 'VIOLENCE', 'HATE_SPEECH', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ReportStatus" AS ENUM ('pending', 'reviewed', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "public"."AppealStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "public"."AdminNotificationSeverity" AS ENUM ('info', 'warning', 'critical', 'action_required');

-- CreateEnum
CREATE TYPE "public"."OtpType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'LOGIN', 'PASSWORD_CHANGE', 'ACCOUNT_DELETION');

-- CreateEnum
CREATE TYPE "public"."ChallengeStatus" AS ENUM ('pending', 'approved', 'rejected', 'active', 'stopped', 'ended');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(255),
    "display_name" VARCHAR(255),
    "email" VARCHAR(255),
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "phone1" VARCHAR(15),
    "phone2" VARCHAR(15),
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "posts_count" INTEGER NOT NULL DEFAULT 0,
    "total_profile_views" INTEGER NOT NULL DEFAULT 0,
    "user_facial_image" BYTEA,
    "selected_category" VARCHAR(255),
    "password" VARCHAR(255),
    "notification" BOOLEAN NOT NULL DEFAULT true,
    "recent_searches" JSONB,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "subscribers" INTEGER NOT NULL DEFAULT 0,
    "remember_me" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(255) NOT NULL DEFAULT 'active',
    "suspended_at" TIMESTAMP(3),
    "suspension_reason" TEXT,
    "role" VARCHAR(255) NOT NULL DEFAULT 'user',
    "profile_picture" VARCHAR(255),
    "bio" TEXT,
    "last_login" TIMESTAMP(3),
    "last_active_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "country_id" INTEGER,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."countries" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(3) NOT NULL,
    "phone_code" VARCHAR(20),
    "flag_emoji" VARCHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."posts" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "video_url" VARCHAR(255),
    "hls_url" VARCHAR(500),
    "thumbnail_url" VARCHAR(500),
    "video_duration" INTEGER,
    "video_width" INTEGER,
    "video_height" INTEGER,
    "processing_status" VARCHAR(50),
    "processing_error" TEXT,
    "status" "public"."PostStatus" NOT NULL DEFAULT 'active',
    "user_id" UUID,
    "approver_id" UUID,
    "admin_id" UUID,
    "approved_at" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "category_id" INTEGER,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "report_count" INTEGER NOT NULL DEFAULT 0,
    "featured_at" TIMESTAMP(3),
    "frozen_at" TIMESTAMP(3),
    "suspended_at" TIMESTAMP(3),
    "suspension_reason" TEXT,
    "suspended_by" UUID,
    "uploadDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" VARCHAR(50) NOT NULL DEFAULT 'text',
    "content" TEXT,
    "is_ad" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "public"."CategoryStatus" NOT NULL DEFAULT 'active',
    "parent_id" INTEGER,
    "level" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."comments" (
    "id" UUID NOT NULL,
    "commentor_id" UUID NOT NULL,
    "comment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "post_id" UUID NOT NULL,
    "comment_text" TEXT,
    "comment_reports" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."post_likes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."views" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "post_id" UUID NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."follows" (
    "id" UUID NOT NULL,
    "followerId" UUID NOT NULL,
    "followingId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" SERIAL NOT NULL,
    "userID" VARCHAR(255) NOT NULL,
    "message" TEXT,
    "type" VARCHAR(255),
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID,
    "postId" UUID,
    "commentId" INTEGER,
    "challengeId" UUID,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_emails" (
    "id" UUID NOT NULL,
    "providerEmailId" VARCHAR(255) NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT,
    "text" TEXT,
    "html" TEXT,
    "headers" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "category" VARCHAR(100),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."recent_searches" (
    "id" SERIAL NOT NULL,
    "userID" VARCHAR(255) NOT NULL,
    "searchTerm" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recent_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan" VARCHAR(255),
    "status" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."shares" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admins" (
    "id" UUID NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "status" VARCHAR(255) NOT NULL DEFAULT 'active',
    "last_login" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."approvers" (
    "id" UUID NOT NULL,
    "username" VARCHAR(255),
    "email" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255),
    "first_name" VARCHAR(255),
    "last_name" VARCHAR(255),
    "phone_number" VARCHAR(255),
    "onboarding_token" VARCHAR(255),
    "password_set" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(255) NOT NULL DEFAULT 'pending',
    "last_login" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ads" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255),
    "content" TEXT,
    "image_url" VARCHAR(255),
    "status" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."account_management" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "balance" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_management_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."post_reports" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" "public"."ReportReason" NOT NULL,
    "description" TEXT,
    "status" "public"."ReportStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."post_appeals" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "appeal_reason" TEXT NOT NULL,
    "additional_info" TEXT,
    "status" "public"."AppealStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "admin_notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" INTEGER NOT NULL,
    "preference_score" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "interaction_count" INTEGER NOT NULL DEFAULT 0,
    "last_interaction" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."featured_posts" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "featured_by" UUID NOT NULL,
    "reason" TEXT,
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "featured_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_notifications" (
    "id" UUID NOT NULL,
    "severity" "public"."AdminNotificationSeverity" NOT NULL,
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

-- CreateTable
CREATE TABLE "public"."otps" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "code" VARCHAR(6) NOT NULL,
    "type" "public"."OtpType" NOT NULL DEFAULT 'EMAIL_VERIFICATION',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "user_id" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."challenges" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "has_rewards" BOOLEAN NOT NULL DEFAULT false,
    "rewards" TEXT,
    "organizer_id" UUID NOT NULL,
    "organizer_name" VARCHAR(255) NOT NULL,
    "organizer_contact" VARCHAR(255) NOT NULL,
    "contact_email" VARCHAR(255),
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "min_content_per_account" INTEGER NOT NULL DEFAULT 1,
    "max_content_per_account" INTEGER NOT NULL DEFAULT 5,
    "scoring_criteria" TEXT,
    "eligibility_criteria" TEXT,
    "what_you_do" TEXT,
    "status" "public"."ChallengeStatus" NOT NULL DEFAULT 'pending',
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "winners_confirmed_at" TIMESTAMP(3),
    "winners_confirmed_by" UUID,
    "max_winners" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."challenge_participants" (
    "id" UUID NOT NULL,
    "challenge_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."challenge_posts" (
    "id" UUID NOT NULL,
    "challenge_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likes_at_challenge_end" INTEGER,
    "winner_rank" INTEGER,

    CONSTRAINT "challenge_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."device_fingerprints" (
    "id" UUID NOT NULL,
    "fingerprint_hash" VARCHAR(64) NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "user_agent" TEXT,
    "os" VARCHAR(100),
    "browser" VARCHAR(100),
    "locale" VARCHAR(20),
    "extra" JSONB,

    CONSTRAINT "device_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_fingerprint_id" UUID NOT NULL,
    "label" VARCHAR(255),
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "first_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."activity_logs" (
    "id" UUID NOT NULL,
    "trace_id" VARCHAR(64) NOT NULL,
    "user_id" UUID,
    "session_id" VARCHAR(255),
    "device_fingerprint_id" UUID,
    "route" VARCHAR(500) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "status_code" INTEGER,
    "success" BOOLEAN NOT NULL,
    "error_code" VARCHAR(100),
    "error_message" TEXT,
    "ip" VARCHAR(45),
    "user_agent" TEXT,
    "location" VARCHAR(255),
    "source" VARCHAR(50) NOT NULL DEFAULT 'api',
    "action_type" VARCHAR(100),
    "meta" JSONB,
    "flags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" UUID NOT NULL,
    "actor_admin_id" UUID,
    "actor_user_id" UUID,
    "action_type" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(100),
    "resource_id" VARCHAR(255),
    "ip" VARCHAR(45),
    "device_fingerprint_id" UUID,
    "details" JSONB,
    "flags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_issues" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "email" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "category" VARCHAR(50),
    "status" VARCHAR(50) NOT NULL DEFAULT 'NEW',
    "metadata" JSONB,
    "admin_response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_fingerprint_id" UUID,
    "user_agent" TEXT,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" UUID,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "public"."users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "countries_name_key" ON "public"."countries"("name");

-- CreateIndex
CREATE UNIQUE INDEX "countries_code_key" ON "public"."countries"("code");

-- CreateIndex
CREATE INDEX "posts_createdAt_idx" ON "public"."posts"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "posts_user_id_idx" ON "public"."posts"("user_id");

-- CreateIndex
CREATE INDEX "posts_user_id_createdAt_idx" ON "public"."posts"("user_id", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "posts_status_createdAt_idx" ON "public"."posts"("status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_parent_id_key" ON "public"."categories"("name", "parent_id");

-- CreateIndex
CREATE INDEX "comments_post_id_idx" ON "public"."comments"("post_id");

-- CreateIndex
CREATE INDEX "comments_commentor_id_comment_date_idx" ON "public"."comments"("commentor_id", "comment_date" DESC);

-- CreateIndex
CREATE INDEX "post_likes_post_id_user_id_idx" ON "public"."post_likes"("post_id", "user_id");

-- CreateIndex
CREATE INDEX "post_likes_user_id_createdAt_idx" ON "public"."post_likes"("user_id", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "post_likes_post_id_createdAt_idx" ON "public"."post_likes"("post_id", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "post_likes_user_id_post_id_key" ON "public"."post_likes"("user_id", "post_id");

-- CreateIndex
CREATE INDEX "views_post_id_createdAt_idx" ON "public"."views"("post_id", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "views_user_id_post_id_key" ON "public"."views"("user_id", "post_id");

-- CreateIndex
CREATE UNIQUE INDEX "views_ip_address_post_id_key" ON "public"."views"("ip_address", "post_id");

-- CreateIndex
CREATE INDEX "follows_followingId_followerId_idx" ON "public"."follows"("followingId", "followerId");

-- CreateIndex
CREATE UNIQUE INDEX "follows_followerId_followingId_key" ON "public"."follows"("followerId", "followingId");

-- CreateIndex
CREATE UNIQUE INDEX "support_emails_providerEmailId_key" ON "public"."support_emails"("providerEmailId");

-- CreateIndex
CREATE INDEX "support_emails_receivedAt_idx" ON "public"."support_emails"("receivedAt" DESC);

-- CreateIndex
CREATE INDEX "support_emails_isRead_receivedAt_idx" ON "public"."support_emails"("isRead", "receivedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "public"."admins"("username");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "public"."admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "approvers_username_key" ON "public"."approvers"("username");

-- CreateIndex
CREATE UNIQUE INDEX "approvers_email_key" ON "public"."approvers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "approvers_onboarding_token_key" ON "public"."approvers"("onboarding_token");

-- CreateIndex
CREATE UNIQUE INDEX "post_reports_post_id_user_id_key" ON "public"."post_reports"("post_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_category_id_key" ON "public"."user_preferences"("user_id", "category_id");

-- CreateIndex
CREATE INDEX "admin_notifications_severity_idx" ON "public"."admin_notifications"("severity");

-- CreateIndex
CREATE INDEX "admin_notifications_category_idx" ON "public"."admin_notifications"("category");

-- CreateIndex
CREATE INDEX "admin_notifications_createdAt_idx" ON "public"."admin_notifications"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "admin_notifications_readAt_idx" ON "public"."admin_notifications"("readAt");

-- CreateIndex
CREATE INDEX "admin_notifications_consolidatedKey_createdAt_idx" ON "public"."admin_notifications"("consolidatedKey", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "otps_email_code_idx" ON "public"."otps"("email", "code");

-- CreateIndex
CREATE INDEX "otps_email_type_verified_idx" ON "public"."otps"("email", "type", "verified");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_participants_challenge_id_user_id_key" ON "public"."challenge_participants"("challenge_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_posts_challenge_id_post_id_key" ON "public"."challenge_posts"("challenge_id", "post_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_fingerprints_fingerprint_hash_key" ON "public"."device_fingerprints"("fingerprint_hash");

-- CreateIndex
CREATE INDEX "device_fingerprints_fingerprint_hash_idx" ON "public"."device_fingerprints"("fingerprint_hash");

-- CreateIndex
CREATE INDEX "device_fingerprints_last_seen_at_idx" ON "public"."device_fingerprints"("last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "user_devices_user_id_idx" ON "public"."user_devices"("user_id");

-- CreateIndex
CREATE INDEX "user_devices_device_fingerprint_id_idx" ON "public"."user_devices"("device_fingerprint_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_user_id_device_fingerprint_id_key" ON "public"."user_devices"("user_id", "device_fingerprint_id");

-- CreateIndex
CREATE INDEX "activity_logs_trace_id_idx" ON "public"."activity_logs"("trace_id");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "public"."activity_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_user_id_created_at_idx" ON "public"."activity_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_device_fingerprint_id_created_at_idx" ON "public"."activity_logs"("device_fingerprint_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_route_created_at_idx" ON "public"."activity_logs"("route", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_ip_created_at_idx" ON "public"."activity_logs"("ip", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_success_created_at_idx" ON "public"."activity_logs"("success", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_source_idx" ON "public"."activity_logs"("source");

-- CreateIndex
CREATE INDEX "activity_logs_action_type_idx" ON "public"."activity_logs"("action_type");

-- CreateIndex
CREATE INDEX "audit_logs_action_type_idx" ON "public"."audit_logs"("action_type");

-- CreateIndex
CREATE INDEX "audit_logs_actor_admin_id_created_at_idx" ON "public"."audit_logs"("actor_admin_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "public"."audit_logs"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "public"."audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "public"."audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "user_issues_user_id_createdAt_idx" ON "public"."user_issues"("user_id", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "user_issues_status_createdAt_idx" ON "public"."user_issues"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "user_sessions_user_id_created_at_idx" ON "public"."user_sessions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "user_sessions_device_fingerprint_id_created_at_idx" ON "public"."user_sessions"("device_fingerprint_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "user_sessions_revoked_at_idx" ON "public"."user_sessions"("revoked_at");

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."posts" ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."posts" ADD CONSTRAINT "posts_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "public"."approvers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."posts" ADD CONSTRAINT "posts_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."posts" ADD CONSTRAINT "posts_suspended_by_fkey" FOREIGN KEY ("suspended_by") REFERENCES "public"."admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."posts" ADD CONSTRAINT "posts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."comments" ADD CONSTRAINT "comments_commentor_id_fkey" FOREIGN KEY ("commentor_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."comments" ADD CONSTRAINT "comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."post_likes" ADD CONSTRAINT "post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."post_likes" ADD CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."views" ADD CONSTRAINT "views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."views" ADD CONSTRAINT "views_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."follows" ADD CONSTRAINT "follows_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."follows" ADD CONSTRAINT "follows_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_userID_fkey" FOREIGN KEY ("userID") REFERENCES "public"."users"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."recent_searches" ADD CONSTRAINT "recent_searches_userID_fkey" FOREIGN KEY ("userID") REFERENCES "public"."users"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shares" ADD CONSTRAINT "shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shares" ADD CONSTRAINT "shares_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."post_reports" ADD CONSTRAINT "post_reports_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."post_reports" ADD CONSTRAINT "post_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."post_reports" ADD CONSTRAINT "post_reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."post_appeals" ADD CONSTRAINT "post_appeals_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."post_appeals" ADD CONSTRAINT "post_appeals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."post_appeals" ADD CONSTRAINT "post_appeals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_preferences" ADD CONSTRAINT "user_preferences_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."featured_posts" ADD CONSTRAINT "featured_posts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."featured_posts" ADD CONSTRAINT "featured_posts_featured_by_fkey" FOREIGN KEY ("featured_by") REFERENCES "public"."admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."otps" ADD CONSTRAINT "otps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."challenges" ADD CONSTRAINT "challenges_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."challenges" ADD CONSTRAINT "challenges_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."challenge_participants" ADD CONSTRAINT "challenge_participants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."challenge_participants" ADD CONSTRAINT "challenge_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."challenge_posts" ADD CONSTRAINT "challenge_posts_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."challenge_posts" ADD CONSTRAINT "challenge_posts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."challenge_posts" ADD CONSTRAINT "challenge_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_devices" ADD CONSTRAINT "user_devices_device_fingerprint_id_fkey" FOREIGN KEY ("device_fingerprint_id") REFERENCES "public"."device_fingerprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activity_logs" ADD CONSTRAINT "activity_logs_device_fingerprint_id_fkey" FOREIGN KEY ("device_fingerprint_id") REFERENCES "public"."device_fingerprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_device_fingerprint_id_fkey" FOREIGN KEY ("device_fingerprint_id") REFERENCES "public"."device_fingerprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_issues" ADD CONSTRAINT "user_issues_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_device_fingerprint_id_fkey" FOREIGN KEY ("device_fingerprint_id") REFERENCES "public"."device_fingerprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
