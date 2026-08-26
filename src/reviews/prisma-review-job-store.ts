import { Prisma, type PrismaClient } from "@prisma/client";

import type { ClaimedReviewJob, ReviewJobStore } from "./review-job-worker.js";

export interface PrismaReviewJobStoreOptions {
  maximumAttempts?: number;
  retryBaseDelayMilliseconds?: number;
}

const DEFAULT_MAXIMUM_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MILLISECONDS = 30_000;

export class PrismaReviewJobStore implements ReviewJobStore {
  private readonly maximumAttempts: number;
  private readonly retryBaseDelayMilliseconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    options: PrismaReviewJobStoreOptions = {},
  ) {
    this.maximumAttempts = options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS;
    this.retryBaseDelayMilliseconds =
      options.retryBaseDelayMilliseconds ?? DEFAULT_RETRY_BASE_DELAY_MILLISECONDS;
    if (!Number.isInteger(this.maximumAttempts) || this.maximumAttempts < 1) {
      throw new RangeError("maximumAttempts must be a positive integer.");
    }
    if (
      !Number.isInteger(this.retryBaseDelayMilliseconds) ||
      this.retryBaseDelayMilliseconds < 0
    ) {
      throw new RangeError("retryBaseDelayMilliseconds must be a non-negative integer.");
    }
  }

  async claimNext(workerId: string): Promise<ClaimedReviewJob | null> {
    const rows = await this.prisma.$transaction((transaction) =>
      transaction.$queryRaw<ClaimedReviewJob[]>(Prisma.sql`
        WITH candidate AS (
          SELECT "id"
          FROM "ReviewJob"
          WHERE "status" = 'QUEUED'::"ReviewJobStatus"
            AND "runAfter" <= NOW()
          ORDER BY "runAfter" ASC, "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "ReviewJob" AS job
        SET
          "status" = 'PROCESSING'::"ReviewJobStatus",
          "attempts" = job."attempts" + 1,
          "lockedAt" = NOW(),
          "lockedBy" = ${workerId},
          "updatedAt" = NOW()
        FROM candidate
        WHERE job."id" = candidate."id"
        RETURNING
          job."attempts",
          job."headSha",
          job."id",
          job."installationGithubId",
          job."owner",
          job."pullRequestNumber",
          job."repositoryGithubId",
          job."repositoryName"
      `),
    );

    return rows[0] ?? null;
  }

  async complete(jobId: string): Promise<void> {
    await this.prisma.reviewJob.updateMany({
      data: {
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        status: "COMPLETED",
      },
      where: { id: jobId, status: "PROCESSING" },
    });
  }

  async cancel(jobId: string): Promise<void> {
    await this.prisma.reviewJob.updateMany({
      data: {
        lastError: "Superseded by a newer pull request head.",
        lockedAt: null,
        lockedBy: null,
        status: "COMPLETED",
      },
      where: { id: jobId, status: "PROCESSING" },
    });
  }

  async fail(jobId: string, attempt: number, error: Error): Promise<void> {
    const terminal = attempt >= this.maximumAttempts;
    await this.prisma.reviewJob.updateMany({
      data: {
        lastError: error.message.slice(0, 8_000),
        lockedAt: null,
        lockedBy: null,
        runAfter: terminal
          ? undefined
          : new Date(
              Date.now() +
                this.retryBaseDelayMilliseconds * 2 ** Math.max(0, attempt - 1),
            ),
        status: terminal ? "FAILED" : "QUEUED",
      },
      where: { attempts: attempt, id: jobId, status: "PROCESSING" },
    });
  }
}
