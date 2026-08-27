-- Durable publication, indexing, and ingress reliability state.
CREATE TYPE "PublicationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'PUBLISHED', 'FAILED');
CREATE TYPE "PublicationKind" AS ENUM ('GITHUB_REVIEW');
CREATE TYPE "RepositoryIndexStatus" AS ENUM ('IDLE', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "RepositoryIndexJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "Repository"
    ADD COLUMN "lastIndexAttemptAt" TIMESTAMP(3),
    ADD COLUMN "lastIndexError" TEXT,
    ADD COLUMN "indexStatus" "RepositoryIndexStatus" NOT NULL DEFAULT 'IDLE',
    ADD COLUMN "indexEmbeddingModel" TEXT;

ALTER TABLE "Finding"
    ADD COLUMN "publicationOutboxId" TEXT;

CREATE TABLE "PublicationOutbox" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "kind" "PublicationKind" NOT NULL DEFAULT 'GITHUB_REVIEW',
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "githubReviewId" BIGINT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicationOutbox_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ReviewJob"
    ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
    ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
    ADD COLUMN "failureCode" TEXT;

CREATE TABLE "RepositoryIndexJob" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "installationGithubId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "repositoryName" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "force" BOOLEAN NOT NULL DEFAULT false,
    "status" "RepositoryIndexJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "indexedDocuments" INTEGER,
    "indexedChunks" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryIndexJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookRateLimit" (
    "key" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookRateLimit_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "PublicationOutbox_reviewId_key" ON "PublicationOutbox"("reviewId");
CREATE UNIQUE INDEX "PublicationOutbox_idempotencyKey_key" ON "PublicationOutbox"("idempotencyKey");
CREATE UNIQUE INDEX "PublicationOutbox_githubReviewId_key" ON "PublicationOutbox"("githubReviewId");
CREATE INDEX "PublicationOutbox_status_runAfter_idx" ON "PublicationOutbox"("status", "runAfter");
CREATE INDEX "PublicationOutbox_status_leaseExpiresAt_idx" ON "PublicationOutbox"("status", "leaseExpiresAt");
CREATE INDEX "Finding_publicationOutboxId_status_idx" ON "Finding"("publicationOutboxId", "status");
CREATE INDEX "ReviewJob_status_leaseExpiresAt_idx" ON "ReviewJob"("status", "leaseExpiresAt");
CREATE UNIQUE INDEX "RepositoryIndexJob_repositoryId_branch_key" ON "RepositoryIndexJob"("repositoryId", "branch");
CREATE INDEX "RepositoryIndexJob_status_runAfter_idx" ON "RepositoryIndexJob"("status", "runAfter");
CREATE INDEX "RepositoryIndexJob_status_leaseExpiresAt_idx" ON "RepositoryIndexJob"("status", "leaseExpiresAt");

ALTER TABLE "PublicationOutbox"
    ADD CONSTRAINT "PublicationOutbox_reviewId_fkey"
    FOREIGN KEY ("reviewId") REFERENCES "Review"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Finding"
    ADD CONSTRAINT "Finding_publicationOutboxId_fkey"
    FOREIGN KEY ("publicationOutboxId") REFERENCES "PublicationOutbox"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RepositoryIndexJob"
    ADD CONSTRAINT "RepositoryIndexJob_repositoryId_fkey"
    FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
