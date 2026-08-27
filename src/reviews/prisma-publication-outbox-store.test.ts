import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPublicationOutboxStore } from "./prisma-publication-outbox-store.js";

test("claims publication work with a lease and finalizes findings in one transaction", async () => {
  const updates: Array<{ data: Record<string, unknown>; where: Record<string, unknown> }> = [];
  const claims = [{
    attempts: 1,
    id: "outbox-1",
    idempotencyKey: "key",
    payload: { comments: [{ line: 1 }] },
    reviewId: "review-1",
  }];
  const transaction = {
    $queryRaw: async <T>() => claims as T,
    finding: { updateMany: async () => ({ count: 1 }) },
    publicationOutbox: {
      updateMany: async (argument: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        updates.push(argument);
        return { count: 1 };
      },
    },
    review: { update: async () => ({}) },
    reviewMetrics: { updateMany: async () => ({ count: 1 }) },
  };
  const prisma = {
    $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
      callback(transaction),
    publicationOutbox: {
      updateMany: async (argument: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        updates.push(argument);
        return { count: 1 };
      },
    },
  };
  const store = new PrismaPublicationOutboxStore(prisma as never, {
    leaseDurationMilliseconds: 100,
    maximumAttempts: 2,
    retryBaseDelayMilliseconds: 1,
  });

  const claimed = await store.claimNext("worker-a");
  assert.equal(claimed?.id, "outbox-1");
  assert.equal(await store.heartbeat("outbox-1", "worker-a"), true);
  assert.equal(
    await store.complete(claimed!, "worker-a", { githubReviewId: 5, htmlUrl: null }),
    true,
  );
  assert.equal(
    await store.fail("outbox-1", "worker-a", 2, {
      code: "INVALID",
      message: "bad payload",
      retryable: false,
    }),
    true,
  );

  assert.ok(updates.some((update) => update.data.status === "PUBLISHED"));
  assert.ok(updates.some((update) => update.data.status === "FAILED"));
});
