import type { PrismaClient } from "@prisma/client";

export class ReviewRetryService {
  constructor(private readonly prisma: PrismaClient) {}

  async retry(reviewId: string): Promise<{ jobId: string } | null> {
    return this.prisma.$transaction(async (transaction) => {
      const review = await transaction.review.findUnique({
        include: {
          pullRequest: {
            include: { repository: { include: { installation: true } } },
          },
        },
        where: { id: reviewId },
      });
      if (review === null) {
        return null;
      }
      if (review.status !== "FAILED") {
        throw new ReviewNotRetryableError();
      }
      const repository = review.pullRequest.repository;
      const now = new Date();
      const existingJob = await transaction.reviewJob.findUnique({
        where: {
          repositoryGithubId_pullRequestNumber_headSha: {
            headSha: review.headSha,
            pullRequestNumber: review.pullRequest.number,
            repositoryGithubId: repository.githubRepositoryId,
          },
        },
      });
      if (
        existingJob?.status === "PROCESSING" ||
        existingJob?.status === "QUEUED"
      ) {
        return { jobId: existingJob.id };
      }
      const job = await transaction.reviewJob.upsert({
        create: {
          headSha: review.headSha,
          installationGithubId: repository.installation.githubInstallationId,
          owner: repository.ownerLogin,
          pullRequestNumber: review.pullRequest.number,
          repositoryGithubId: repository.githubRepositoryId,
          repositoryName: repository.name,
          runAfter: now,
          status: "QUEUED",
        },
        update: {
          attempts: 0,
          failureCode: null,
          lastError: null,
          lastHeartbeatAt: null,
          leaseExpiresAt: null,
          lockedAt: null,
          lockedBy: null,
          runAfter: now,
          status: "QUEUED",
        },
        where: {
          repositoryGithubId_pullRequestNumber_headSha: {
            headSha: review.headSha,
            pullRequestNumber: review.pullRequest.number,
            repositoryGithubId: repository.githubRepositoryId,
          },
        },
      });
      await transaction.review.update({
        data: {
          completedAt: null,
          failureReason: null,
          startedAt: null,
          status: "QUEUED",
          trigger: "RETRY",
        },
        where: { id: review.id },
      });
      return { jobId: job.id };
    });
  }
}

export class ReviewNotRetryableError extends Error {
  constructor() {
    super("Only failed reviews can be retried.");
    this.name = "ReviewNotRetryableError";
  }
}
