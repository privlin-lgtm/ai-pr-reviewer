CREATE TYPE "ReviewJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('RECEIVED', 'ENQUEUED', 'FAILED');

CREATE TABLE "ReviewJob" (
    "id" TEXT NOT NULL,
    "installationGithubId" BIGINT NOT NULL,
    "repositoryGithubId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "repositoryName" TEXT NOT NULL,
    "pullRequestNumber" INTEGER NOT NULL,
    "headSha" TEXT NOT NULL,
    "status" "ReviewJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReviewJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "githubDeliveryId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "action" TEXT,
    "payloadHash" TEXT NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'RECEIVED',
    "reviewJobId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReviewJob_repositoryGithubId_pullRequestNumber_headSha_key"
    ON "ReviewJob"("repositoryGithubId", "pullRequestNumber", "headSha");
CREATE INDEX "ReviewJob_status_runAfter_idx" ON "ReviewJob"("status", "runAfter");
CREATE UNIQUE INDEX "WebhookDelivery_githubDeliveryId_key" ON "WebhookDelivery"("githubDeliveryId");
CREATE INDEX "WebhookDelivery_reviewJobId_idx" ON "WebhookDelivery"("reviewJobId");

ALTER TABLE "WebhookDelivery"
    ADD CONSTRAINT "WebhookDelivery_reviewJobId_fkey"
    FOREIGN KEY ("reviewJobId") REFERENCES "ReviewJob"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
