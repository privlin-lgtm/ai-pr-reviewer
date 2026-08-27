import { Prisma, type PrismaClient } from "@prisma/client";

import type { PublishedReview } from "../github/types.js";
import { redactMessage } from "../observability/structured-logger.js";
import type { ClassifiedJobFailure } from "./job-failure.js";
import type {
  ClaimedPublicationOutbox,
  PublicationOutboxStore,
  ReviewPublicationPayload,
} from "./publication-outbox.js";

export interface PrismaPublicationOutboxStoreOptions {
  leaseDurationMilliseconds?: number;
  maximumAttempts?: number;
  maximumRetryDelayMilliseconds?: number;
  retryBaseDelayMilliseconds?: number;
}

const DEFAULT_LEASE_DURATION_MILLISECONDS = 120_000;
const DEFAULT_MAXIMUM_ATTEMPTS = 5;
const DEFAULT_MAXIMUM_RETRY_DELAY_MILLISECONDS = 30 * 60_000;
const DEFAULT_RETRY_BASE_DELAY_MILLISECONDS = 15_000;

export class PrismaPublicationOutboxStore implements PublicationOutboxStore {
  private readonly leaseDurationMilliseconds: number;
  private readonly maximumAttempts: number;
  private readonly maximumRetryDelayMilliseconds: number;
  private readonly retryBaseDelayMilliseconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    options: PrismaPublicationOutboxStoreOptions = {},
  ) {
    this.leaseDurationMilliseconds =
      options.leaseDurationMilliseconds ?? DEFAULT_LEASE_DURATION_MILLISECONDS;
    this.maximumAttempts = options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS;
    this.maximumRetryDelayMilliseconds =
      options.maximumRetryDelayMilliseconds ?? DEFAULT_MAXIMUM_RETRY_DELAY_MILLISECONDS;
    this.retryBaseDelayMilliseconds =
      options.retryBaseDelayMilliseconds ?? DEFAULT_RETRY_BASE_DELAY_MILLISECONDS;
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
      throw new RangeError("Invalid publication retry delay configuration.");
    }
  }

  async claimNext(workerId: string): Promise<ClaimedPublicationOutbox | null> {
    if (workerId.trim().length === 0) {
      throw new Error("workerId is required to claim publication work.");
    }
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ClaimedPublicationOutbox[]>(Prisma.sql`
        WITH expired AS (
          UPDATE "PublicationOutbox"
          SET
            "status" = 'FAILED'::"PublicationStatus",
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "leaseExpiresAt" = NULL,
            "lastError" = COALESCE(
              "lastError",
              'Publication lease expired after the maximum number of attempts.'
            ),
            "updatedAt" = NOW()
          WHERE "status" = 'PROCESSING'::"PublicationStatus"
            AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= NOW())
            AND "attempts" >= ${this.maximumAttempts}
        ),
        candidate AS (
          SELECT "id"
          FROM "PublicationOutbox"
          WHERE (
            ("status" = 'QUEUED'::"PublicationStatus" AND "runAfter" <= NOW())
            OR (
              "status" = 'PROCESSING'::"PublicationStatus"
              AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= NOW())
              AND "attempts" < ${this.maximumAttempts}
            )
          )
          ORDER BY
            CASE WHEN "status" = 'QUEUED'::"PublicationStatus" THEN "runAfter"
              ELSE COALESCE("leaseExpiresAt", "lockedAt", "createdAt")
            END ASC,
            "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "PublicationOutbox" AS outbox
        SET
          "status" = 'PROCESSING'::"PublicationStatus",
          "attempts" = outbox."attempts" + 1,
          "lockedAt" = NOW(),
          "lockedBy" = ${workerId},
          "leaseExpiresAt" = NOW() + (${this.leaseDurationMilliseconds} * INTERVAL '1 millisecond'),
          "updatedAt" = NOW()
        FROM candidate
        WHERE outbox."id" = candidate."id"
        RETURNING
          outbox."attempts",
          outbox."id",
          outbox."idempotencyKey",
          outbox."payload",
          outbox."reviewId"
      `);
      await transaction.finding.updateMany({
        data: { status: "FAILED" },
        where: {
          publicationOutbox: { is: { status: "FAILED" } },
          status: "PENDING",
        },
      });
      return rows[0] ?? null;
    });
  }

  async heartbeat(outboxId: string, workerId: string): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.publicationOutbox.updateMany({
      data: {
        leaseExpiresAt: new Date(now.valueOf() + this.leaseDurationMilliseconds),
      },
      where: {
        id: outboxId,
        leaseExpiresAt: { gt: now },
        lockedBy: workerId,
        status: "PROCESSING",
      },
    });
    return result.count === 1;
  }

  async complete(
    outbox: ClaimedPublicationOutbox,
    workerId: string,
    published: PublishedReview,
  ): Promise<boolean> {
    const payload = outbox.payload as ReviewPublicationPayload;
    const commentsPublished = Array.isArray(payload.comments) ? payload.comments.length : 0;
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const updated = await transaction.publicationOutbox.updateMany({
        data: {
          githubReviewId: BigInt(published.githubReviewId),
          lastError: null,
          leaseExpiresAt: null,
          lockedAt: null,
          lockedBy: null,
          publishedAt: new Date(),
          status: "PUBLISHED",
        },
        where: {
          id: outbox.id,
          leaseExpiresAt: { gt: now },
          lockedBy: workerId,
          status: "PROCESSING",
        },
      });
      if (updated.count !== 1) {
        return false;
      }

      const publishedAt = new Date();
      await transaction.finding.updateMany({
        data: { publishedAt, status: "PUBLISHED" },
        where: { publicationOutboxId: outbox.id, status: "PENDING" },
      });
      await transaction.review.update({
        data: { githubReviewId: BigInt(published.githubReviewId) },
        where: { id: outbox.reviewId },
      });
      await transaction.reviewMetrics.updateMany({
        data: { commentsPublished },
        where: { reviewId: outbox.reviewId },
      });
      return true;
    });
  }

  async fail(
    outboxId: string,
    workerId: string,
    attempt: number,
    failure: ClassifiedJobFailure,
  ): Promise<boolean> {
    const terminal = !failure.retryable || attempt >= this.maximumAttempts;
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const updated = await transaction.publicationOutbox.updateMany({
        data: {
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
          id: outboxId,
          leaseExpiresAt: { gt: now },
          lockedBy: workerId,
          status: "PROCESSING",
        },
      });
      if (updated.count !== 1) {
        return false;
      }
      if (terminal) {
        await transaction.finding.updateMany({
          data: { status: "FAILED" },
          where: { publicationOutboxId: outboxId, status: "PENDING" },
        });
      }
      return true;
    });
  }
}
