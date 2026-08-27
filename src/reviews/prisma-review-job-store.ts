import { Prisma, type PrismaClient } from "@prisma/client";

import type { ClassifiedJobFailure } from "./job-failure.js";
import type { ClaimedReviewJob, ReviewJobStore } from "./review-job-worker.js";

export interface PrismaReviewJobStoreOptions {
  leaseDurationMilliseconds?: number;
  maximumAttempts?: number;
  maximumRetryDelayMilliseconds?: number;
  retryBaseDelayMilliseconds?: number;
}

const DEFAULT_LEASE_DURATION_MILLISECONDS = 120_000;
const DEFAULT_MAXIMUM_ATTEMPTS = 3;
const DEFAULT_MAXIMUM_RETRY_DELAY_MILLISECONDS = 30 * 60_000;
const DEFAULT_RETRY_BASE_DELAY_MILLISECONDS = 30_000;

export class PrismaReviewJobStore implements ReviewJobStore {
  private readonly leaseDurationMilliseconds: number;
  private readonly maximumAttempts: number;
  private readonly maximumRetryDelayMilliseconds: number;
  private readonly retryBaseDelayMilliseconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    options: PrismaReviewJobStoreOptions = {},
  ) {
    this.leaseDurationMilliseconds =
      options.leaseDurationMilliseconds ?? DEFAULT_LEASE_DURATION_MILLISECONDS;
    this.maximumAttempts = options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS;
    this.maximumRetryDelayMilliseconds =
      options.maximumRetryDelayMilliseconds ?? DEFAULT_MAXIMUM_RETRY_DELAY_MILLISECONDS;
    this.retryBaseDelayMilliseconds =
      options.retryBaseDelayMilliseconds ?? DEFAULT_RETRY_BASE_DELAY_MILLISECONDS;
    if (
      !Number.isInteger(this.leaseDurationMilliseconds) ||
      this.leaseDurationMilliseconds < 1
    ) {
      throw new RangeError("leaseDurationMilliseconds must be a positive integer.");
    }
    if (!Number.isInteger(this.maximumAttempts) || this.maximumAttempts < 1) {
      throw new RangeError("maximumAttempts must be a positive integer.");
    }
    if (
      !Number.isInteger(this.retryBaseDelayMilliseconds) ||
      this.retryBaseDelayMilliseconds < 0
    ) {
      throw new RangeError("retryBaseDelayMilliseconds must be a non-negative integer.");
    }
    if (
      !Number.isInteger(this.maximumRetryDelayMilliseconds) ||
      this.maximumRetryDelayMilliseconds < this.retryBaseDelayMilliseconds
    ) {
      throw new RangeError(
        "maximumRetryDelayMilliseconds must be an integer at least retryBaseDelayMilliseconds.",
      );
    }
  }

  async claimNext(workerId: string): Promise<ClaimedReviewJob | null> {
    if (workerId.trim().length === 0) {
      throw new Error("workerId is required to claim a review job.");
    }
    const rows = await this.prisma.$transaction((transaction) =>
      transaction.$queryRaw<ClaimedReviewJob[]>(Prisma.sql`
        WITH expired AS (
          UPDATE "ReviewJob"
          SET
            "status" = 'FAILED'::"ReviewJobStatus",
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "leaseExpiresAt" = NULL,
            "failureCode" = 'LEASE_EXPIRED',
            "lastError" = COALESCE(
              "lastError",
              'Worker lease expired after the maximum number of attempts.'
            ),
            "updatedAt" = NOW()
          WHERE "status" = 'PROCESSING'::"ReviewJobStatus"
            AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= NOW())
            AND "attempts" >= ${this.maximumAttempts}
        ),
        candidate AS (
          SELECT "id"
          FROM "ReviewJob"
          WHERE (
            ("status" = 'QUEUED'::"ReviewJobStatus" AND "runAfter" <= NOW())
            OR (
              "status" = 'PROCESSING'::"ReviewJobStatus"
              AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= NOW())
              AND "attempts" < ${this.maximumAttempts}
            )
          )
          ORDER BY
            CASE WHEN "status" = 'QUEUED'::"ReviewJobStatus" THEN "runAfter"
              ELSE COALESCE("leaseExpiresAt", "lockedAt", "createdAt")
            END ASC,
            "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "ReviewJob" AS job
        SET
          "status" = 'PROCESSING'::"ReviewJobStatus",
          "attempts" = job."attempts" + 1,
          "lockedAt" = NOW(),
          "lockedBy" = ${workerId},
          "leaseExpiresAt" = NOW() + (${this.leaseDurationMilliseconds} * INTERVAL '1 millisecond'),
          "lastHeartbeatAt" = NOW(),
          "failureCode" = NULL,
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

  async complete(jobId: string, workerId: string): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.reviewJob.updateMany({
      data: {
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        status: "COMPLETED",
      },
      where: {
        id: jobId,
        leaseExpiresAt: { gt: now },
        lockedBy: workerId,
        status: "PROCESSING",
      },
    });
    return result.count === 1;
  }

  async cancel(jobId: string, workerId: string): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.reviewJob.updateMany({
      data: {
        lastError: "Superseded by a newer pull request head.",
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        status: "COMPLETED",
      },
      where: {
        id: jobId,
        leaseExpiresAt: { gt: now },
        lockedBy: workerId,
        status: "PROCESSING",
      },
    });
    return result.count === 1;
  }

  async heartbeat(jobId: string, workerId: string): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.reviewJob.updateMany({
      data: {
        lastHeartbeatAt: now,
        leaseExpiresAt: new Date(now.valueOf() + this.leaseDurationMilliseconds),
      },
      where: {
        id: jobId,
        leaseExpiresAt: { gt: now },
        lockedBy: workerId,
        status: "PROCESSING",
      },
    });
    return result.count === 1;
  }

  async fail(
    jobId: string,
    workerId: string,
    attempt: number,
    failure: ClassifiedJobFailure,
  ): Promise<boolean> {
    const terminal = !failure.retryable || attempt >= this.maximumAttempts;
    const now = new Date();
    const result = await this.prisma.reviewJob.updateMany({
      data: {
        failureCode: failure.code.slice(0, 128),
        lastError: failure.message.slice(0, 8_000),
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        runAfter: terminal
          ? undefined
          : new Date(
              Date.now() +
                Math.min(
                  this.retryBaseDelayMilliseconds * 2 ** Math.max(0, attempt - 1),
                  this.maximumRetryDelayMilliseconds,
                ),
            ),
        status: terminal ? "FAILED" : "QUEUED",
      },
      where: {
        attempts: attempt,
        id: jobId,
        leaseExpiresAt: { gt: now },
        lockedBy: workerId,
        status: "PROCESSING",
      },
    });
    return result.count === 1;
  }
}
