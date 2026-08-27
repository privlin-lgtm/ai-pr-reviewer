import type { PrismaClient } from "@prisma/client";

export interface RepositoryIndexRequest {
  force?: boolean;
  repositoryId: string;
}

export interface RepositoryIndexQueueResult {
  jobId: string;
  scheduled: boolean;
}

export class RepositoryNotFoundError extends Error {
  constructor(repositoryId: string) {
    super(`Repository ${repositoryId} was not found.`);
    this.name = "RepositoryNotFoundError";
  }
}

export class RepositoryIndexQueue {
  constructor(private readonly prisma: PrismaClient) {}

  async enqueue(request: RepositoryIndexRequest): Promise<RepositoryIndexQueueResult> {
    if (request.repositoryId.trim().length === 0) {
      throw new Error("repositoryId is required.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const repository = await transaction.repository.findUnique({
        include: {
          installation: {
            select: { githubInstallationId: true },
          },
        },
        where: { id: request.repositoryId },
      });
      if (repository === null) {
        throw new RepositoryNotFoundError(request.repositoryId);
      }
      if (!repository.isEnabled) {
        throw new Error("Repository indexing is disabled.");
      }

      const existing = await transaction.repositoryIndexJob.findUnique({
        where: {
          repositoryId_branch: {
            branch: repository.defaultBranch,
            repositoryId: repository.id,
          },
        },
      });
      if (existing?.status === "PROCESSING") {
        return { jobId: existing.id, scheduled: false };
      }
      if (existing?.status === "COMPLETED" && request.force !== true) {
        return { jobId: existing.id, scheduled: false };
      }

      const now = new Date();
      const job = await transaction.repositoryIndexJob.upsert({
        create: {
          branch: repository.defaultBranch,
          force: request.force ?? false,
          installationGithubId: repository.installation.githubInstallationId,
          owner: repository.ownerLogin,
          repositoryId: repository.id,
          repositoryName: repository.name,
          runAfter: now,
          status: "QUEUED",
        },
        update: {
          completedAt: null,
          force: request.force ?? existing?.force ?? false,
          lastError: null,
          runAfter: now,
          status: "QUEUED",
        },
        where: {
          repositoryId_branch: {
            branch: repository.defaultBranch,
            repositoryId: repository.id,
          },
        },
      });
      await transaction.repository.update({
        data: {
          indexStatus: "QUEUED",
          lastIndexAttemptAt: now,
          lastIndexError: null,
        },
        where: { id: repository.id },
      });
      return { jobId: job.id, scheduled: true };
    });
  }
}
