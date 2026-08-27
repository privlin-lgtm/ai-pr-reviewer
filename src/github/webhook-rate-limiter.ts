import { Prisma, type PrismaClient } from "@prisma/client";

export interface WebhookRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface WebhookRateLimiter {
  consume(key: string): Promise<WebhookRateLimitDecision>;
}

export interface PrismaWebhookRateLimiterOptions {
  limit?: number;
  windowMilliseconds?: number;
}

const DEFAULT_LIMIT = 120;
const DEFAULT_WINDOW_MILLISECONDS = 60_000;

export class PrismaWebhookRateLimiter implements WebhookRateLimiter {
  private readonly limit: number;
  private readonly windowMilliseconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    options: PrismaWebhookRateLimiterOptions = {},
  ) {
    this.limit = options.limit ?? DEFAULT_LIMIT;
    this.windowMilliseconds = options.windowMilliseconds ?? DEFAULT_WINDOW_MILLISECONDS;
    if (!Number.isInteger(this.limit) || this.limit < 1) {
      throw new RangeError("Webhook rate limit must be a positive integer.");
    }
    if (!Number.isInteger(this.windowMilliseconds) || this.windowMilliseconds < 1) {
      throw new RangeError("Webhook rate window must be a positive integer.");
    }
  }

  async consume(key: string): Promise<WebhookRateLimitDecision> {
    if (key.trim().length === 0) {
      throw new Error("Webhook rate-limit key is required.");
    }
    const rows = await this.prisma.$queryRaw<
      Array<{ count: number; windowStartedAt: Date }>
    >(Prisma.sql`
      INSERT INTO "WebhookRateLimit" (
        "key", "windowStartedAt", "count", "createdAt", "updatedAt"
      ) VALUES (
        ${key}, NOW(), 1, NOW(), NOW()
      )
      ON CONFLICT ("key") DO UPDATE
      SET
        "count" = CASE
          WHEN "WebhookRateLimit"."windowStartedAt" <=
            NOW() - (${this.windowMilliseconds} * INTERVAL '1 millisecond')
          THEN 1
          ELSE "WebhookRateLimit"."count" + 1
        END,
        "windowStartedAt" = CASE
          WHEN "WebhookRateLimit"."windowStartedAt" <=
            NOW() - (${this.windowMilliseconds} * INTERVAL '1 millisecond')
          THEN NOW()
          ELSE "WebhookRateLimit"."windowStartedAt"
        END,
        "updatedAt" = NOW()
      RETURNING "count", "windowStartedAt"
    `);
    const row = rows[0];
    if (row === undefined) {
      throw new Error("Webhook rate-limit update returned no row.");
    }
    const retryAfterMilliseconds = Math.max(
      0,
      row.windowStartedAt.valueOf() + this.windowMilliseconds - Date.now(),
    );
    return {
      allowed: Number(row.count) <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMilliseconds / 1_000)),
    };
  }
}
