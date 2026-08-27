import assert from "node:assert/strict";
import test from "node:test";

import { PrismaWebhookRateLimiter } from "./webhook-rate-limiter.js";

test("uses the durable counter result to return a bounded retry window", async () => {
  const windowStartedAt = new Date();
  const prisma = {
    $queryRaw: async <T>() => [{ count: 3, windowStartedAt }] as T,
  };
  const limiter = new PrismaWebhookRateLimiter(prisma as never, {
    limit: 2,
    windowMilliseconds: 5_000,
  });

  const result = await limiter.consume("installation:12");
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 5);
});
