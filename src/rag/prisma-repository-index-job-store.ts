import { Prisma, type PrismaClient } from "@prisma/client";

import { redactMessage } from "../observability/structured-logger.js";
import type { ClassifiedJobFailure } from "../reviews/job-failure.js";
import type { RepositoryIndexingResult } from "./repository-standards-indexer.js";
import type {
  ClaimedRepositoryIndexJob,
  RepositoryIndexJobStore,
} from "./repository-index-job.js";

export interface PrismaRepositoryIndexJobStoreOptions {
  embeddingModel: string;
  leaseDurationMilliseconds?: number;
  maximumAttempts?: number;
  maximumRetryDelayMilliseconds?: number;
  retryBaseDelayMilliseconds?: number;
}

const DEFAULT_LEASE_DURATION_MILLISECONDS = 300_000;
const DEFAULT_MAXIMUM_ATTEMPTS = 3;
const DEFAULT_MAXIMUM_RETRY_DELAY_MILLISECONDS = 30 * 60_000;
const DEFAULT_RETRY_BASE_DELAY_MILLISECONDS = 30_000;

export class PrismaRepositoryIndexJobStore implements RepositoryIndexJobStore {
  private readonly leaseDurationMilliseconds: number;
  private readonly maximumAttempts: number;
  private readonly maximumRetryDelayMilliseconds: number;
  private readonly retryBaseDelayMilliseconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: PrismaRepositoryIndexJobStoreOptions,
  ) {
    this.leaseDurationMilliseconds =
      options.leaseDurationMilliseconds ?? DEFAULT_LEASE_DURATION_MILLISECONDS;
    this.maximumAttempts = options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS;
    this.maximumRetryDelayMilliseconds =
      options.maximumRetryDelayMilliseconds ?? DEFAULT_MAXIMUM_RETRY_DELAY_MILLISECONDS;
    this.retryBaseDelayMilliseconds =
      options.retryBaseDelayMilliseconds ?? DEFAULT_RETRY_BASE_DELAY_MILLISECONDS;
    if (options.embeddingModel.trim().length === 0) {
      throw new Error("embeddingModel is required.");
    }
    for (const [name, value] of [
      ["leaseDurationMilliseconds", this.leaseDurationMilliseconds],
      ["maximumAttempts", this.maximumAttempts],
      ["maximumRetryDelayMilliseconds", this.maximumRetryDelayMilliseconds],
    ] as const) {
      if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive integer.`);
      }
    }
    if (
      !Number.isInteger(this.retryBaseDelayMilliseconds) ||
      this.retryBaseDelayMilliseconds < 0 ||
      this.maximumRetryDelayMilliseconds < this.retryBaseDelayMilliseconds
    ) {
      throw new RangeError("Invalid repository index retry delay configuration.");
    }
  }

  async claimNext(workerId: string): Promise<ClaimedRepositoryIndexJob | null> {
    if (workerId.trim().length === 0) {
      throw new Error("workerId is required to claim repository indexing work.");
    }
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ClaimedRepositoryIndexJob[]>(Prisma.sql`
        WITH expired AS (
          UPDATE "RepositoryIndexJob"
          SET
            "status" = 'FAILED'::"RepositoryIndexJobStatus",
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "leaseExpiresAt" = NULL,
            "failureCode" = 'LEASE_EXPIRED',
            "lastError" = COALESCE(
              "lastError",
              'Repository index lease expired after the maximum number of attempts.'
            ),
            "updatedAt" = NOW()
          WHERE "status" = 'PROCESSING'::"RepositoryIndexJobStatus"
            AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= NOW())
            AND "attempts" >= ${this.maximumAttempts}
        ),
        candidate AS (
          SELECT "id"
          FROM "RepositoryIndexJob"
          WHERE (
            ("status" = 'QUEUED'::"RepositoryIndexJobStatus" AND "runAfter" <= NOW())
            OR (
              "status" = 'PROCESSING'::"RepositoryIndexJobStatus"
              AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= NOW())
              AND "attempts" < ${this.maximumAttempts}
            )
          )
          ORDER BY
            CASE WHEN "status" = 'QUEUED'::"RepositoryIndexJobStatus" THEN "runAfter"
              ELSE COALESCE("leaseExpiresAt", "lockedAt", "createdAt")
            END ASC,
            "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "RepositoryIndexJob" AS job
        SET
          "status" = 'PROCESSING'::"RepositoryIndexJobStatus",
          "attempts" = job."attempts" + 1,
          "lockedAt" = NOW(),
          "lockedBy" = ${workerId},
          "leaseExpiresAt" = NOW() + (${this.leaseDurationMilliseconds} * INTERVAL '1 millisecond'),
          "lastHeartbeatAt" = NOW(),
          "failureCode" = NULL,
          "startedAt" = COALESCE(job."startedAt", NOW()),
          "updatedAt" = NOW()
        FROM candidate
        WHERE job."id" = candidate."id"
        RETURNING
          job."attempts",
          job."branch",
          job."id",
          job."installationGithubId",
          job."owner",
          job."repositoryId",
          job."repositoryName"
      `);
      await transaction.repository.updateMany({
        data: {
          indexStatus: "FAILED",
          lastIndexError: "Repository index lease expired after the maximum number of attempts.",
        },
        where: {
          indexJobs: {
            some: {
              failureCode: "LEASE_EXPIRED",
              status: "FAILED",
            },
          },
          indexStatus: "PROCESSING",
        },
      });
      const job = rows[0] ?? null;
      if (job !== null) {
        await transaction.repository.update({
          data: {
            indexStatus: "PROCESSING",
            lastIndexAttemptAt: new Date(),
            lastIndexError: null,
          },
          where: { id: job.repositoryId },
        });
      }
      return job;
    });
  }

  async heartbeat(jobId: string, workerId: string): Promise<boolean> {
    const now = new Date();
    const updated = await this.prisma.repositoryIndexJob.updateMany({
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
    return updated.count === 1;
  }

  async complete(
    job: ClaimedRepositoryIndexJob,
    workerId: string,
    result: RepositoryIndexingResult,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const updated = await transaction.repositoryIndexJob.updateMany({
        data: {
          completedAt: new Date(),
          indexedChunks: result.indexedChunks,
          indexedDocuments: result.indexedDocuments,
          lastError: null,
          leaseExpiresAt: null,
          lockedAt: null,
          lockedBy: null,
          status: "COMPLETED",
        },
        where: {
          id: job.id,
          leaseExpiresAt: { gt: now },
          lockedBy: workerId,
          status: "PROCESSING",
        },
      });
      if (updated.count !== 1) {
        return false;
      }
      await transaction.repository.update({
        data: {
          indexEmbeddingModel: this.options.embeddingModel,
          indexStatus: "COMPLETED",
          lastIndexError: null,
          lastIndexedAt: new Date(),
        },
        where: { id: job.repositoryId },
      });
      return true;
    });
  }

  async fail(
    jobId: string,
    workerId: string,
    attempt: number,
    failure: ClassifiedJobFailure,
  ): Promise<boolean> {
    const terminal = !failure.retryable || attempt >= this.maximumAttempts;
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const updated = await transaction.repositoryIndexJob.updateMany({
        data: {
          failureCode: failure.code.slice(0, 128),
          lastError: redactMessage(failure.message, 8_000),
          leaseExpiresAt: null,
          lockedAt: null,
          lockedBy: null,
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
      if (updated.count !== 1) {
        return false;
      }
      if (terminal) {
        const job = await transaction.repositoryIndexJob.findUnique({
          select: { repositoryId: true },
          where: { id: jobId },
        });
        if (job !== null) {
          await transaction.repository.update({
            data: {
              indexStatus: "FAILED",
              lastIndexError: redactMessage(failure.message, 8_000),
            },
            where: { id: job.repositoryId },
          });
        }
      }
      return true;
    });
  }
}
