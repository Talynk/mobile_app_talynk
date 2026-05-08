CREATE TABLE "app_settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_settings_key_key" ON "app_settings"("key");

INSERT INTO "app_settings" ("id", "key", "value", "description", "createdAt", "updatedAt")
VALUES (
    '8c15b7fd-0c7e-4c33-b478-04f04f6f6d05',
    'post_report_suspend_threshold',
    '5',
    'Number of reports required to auto-suspend a post',
    NOW(),
    NOW()
)
ON CONFLICT ("key") DO NOTHING;
