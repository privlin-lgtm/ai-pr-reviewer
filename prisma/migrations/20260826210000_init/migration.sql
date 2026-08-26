-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RepositoryRole" AS ENUM ('OWNER', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "PullRequestState" AS ENUM ('OPEN', 'CLOSED', 'MERGED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewTrigger" AS ENUM ('WEBHOOK', 'MANUAL', 'RETRY');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('PENDING', 'PUBLISHED', 'SUPPRESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "DiffSide" AS ENUM ('LEFT', 'RIGHT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "githubUserId" BIGINT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubInstallation" (
    "id" TEXT NOT NULL,
    "githubInstallationId" BIGINT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "installedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "suspendedAt" TIMESTAMP(3),

    CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "githubRepositoryId" BIGINT NOT NULL,
    "fullName" TEXT NOT NULL,
    "ownerLogin" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "reviewSettings" JSONB,
    "lastIndexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryDocument" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "contentSha" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embeddingDimensions" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "role" "RepositoryRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "githubPullRequestId" BIGINT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "authorGithubLogin" TEXT NOT NULL,
    "authorGithubUserId" BIGINT,
    "state" "PullRequestState" NOT NULL DEFAULT 'OPEN',
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "baseBranch" TEXT NOT NULL,
    "baseSha" TEXT NOT NULL,
    "headBranch" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "githubCreatedAt" TIMESTAMP(3) NOT NULL,
    "githubUpdatedAt" TIMESTAMP(3) NOT NULL,
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "githubReviewId" BIGINT,
    "headSha" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" "ReviewTrigger" NOT NULL DEFAULT 'WEBHOOK',
    "riskScore" INTEGER,
    "summary" TEXT,
    "modelName" TEXT,
    "promptVersion" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "githubCommentId" BIGINT,
    "fingerprint" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "startLine" INTEGER,
    "endLine" INTEGER,
    "side" "DiffSide",
    "severity" "FindingSeverity" NOT NULL,
    "category" TEXT NOT NULL,
    "confidence" DECIMAL(3,2) NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "suggestedFix" TEXT,
    "evidence" JSONB,
    "status" "FindingStatus" NOT NULL DEFAULT 'PENDING',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewMetrics" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "embeddingInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "modelCallCount" INTEGER NOT NULL DEFAULT 0,
    "filesChanged" INTEGER NOT NULL DEFAULT 0,
    "filesAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "commentsPublished" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubUserId_key" ON "User"("githubUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubLogin_key" ON "User"("githubLogin");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubInstallation_githubInstallationId_key" ON "GitHubInstallation"("githubInstallationId");

-- CreateIndex
CREATE INDEX "GitHubInstallation_installedByUserId_idx" ON "GitHubInstallation"("installedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubRepositoryId_key" ON "Repository"("githubRepositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_fullName_key" ON "Repository"("fullName");

-- CreateIndex
CREATE INDEX "Repository_installationId_idx" ON "Repository"("installationId");

-- CreateIndex
CREATE INDEX "RepositoryDocument_repositoryId_branch_path_idx" ON "RepositoryDocument"("repositoryId", "branch", "path");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryDocument_repositoryId_path_branch_contentSha_chun_key" ON "RepositoryDocument"("repositoryId", "path", "branch", "contentSha", "chunkIndex");

-- CreateIndex
CREATE INDEX "RepositoryMembership_repositoryId_idx" ON "RepositoryMembership"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryMembership_userId_repositoryId_key" ON "RepositoryMembership"("userId", "repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_githubPullRequestId_key" ON "PullRequest"("githubPullRequestId");

-- CreateIndex
CREATE INDEX "PullRequest_repositoryId_state_githubUpdatedAt_idx" ON "PullRequest"("repositoryId", "state", "githubUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_repositoryId_number_key" ON "PullRequest"("repositoryId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Review_githubReviewId_key" ON "Review"("githubReviewId");

-- CreateIndex
CREATE INDEX "Review_pullRequestId_createdAt_idx" ON "Review"("pullRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_status_createdAt_idx" ON "Review"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_pullRequestId_headSha_key" ON "Review"("pullRequestId", "headSha");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_githubCommentId_key" ON "Finding"("githubCommentId");

-- CreateIndex
CREATE INDEX "Finding_reviewId_status_severity_idx" ON "Finding"("reviewId", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_reviewId_fingerprint_key" ON "Finding"("reviewId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewMetrics_reviewId_key" ON "ReviewMetrics"("reviewId");

-- AddForeignKey
ALTER TABLE "GitHubInstallation" ADD CONSTRAINT "GitHubInstallation_installedByUserId_fkey" FOREIGN KEY ("installedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryDocument" ADD CONSTRAINT "RepositoryDocument_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryMembership" ADD CONSTRAINT "RepositoryMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryMembership" ADD CONSTRAINT "RepositoryMembership_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewMetrics" ADD CONSTRAINT "ReviewMetrics_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "RepositoryDocument"
    ADD COLUMN "embedding" vector(1536) NOT NULL;

CREATE INDEX "RepositoryDocument_embedding_hnsw_idx"
    ON "RepositoryDocument" USING hnsw ("embedding" vector_cosine_ops);
