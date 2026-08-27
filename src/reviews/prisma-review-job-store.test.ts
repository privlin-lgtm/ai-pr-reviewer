import assert from "node:assert/strict";
import test from "node:test";

import { PrismaReviewJobStore } from "./prisma-review-job-store.js";

test("claims jobs with leases and records owned retry or terminal transitions", async () => {
  const updates: Array<{ data: Record<string, unknown>; where: Record<string, unknown> }> = [];
  const claimed = {
    attempts: 1,
    headSha: "abc",
    id: "job-1",
    installationGithubId: 1n,
    owner: "octocat",
    pullRequestNumber: 2,
    repositoryGithubId: 3n,
    repositoryName: "repo",
  };
  const prisma = {
    $transaction: async <T>(callback: (transaction: {
      $queryRaw: <TResult>() => Promise<TResult>;
    }) => Promise<T>) =>
      callback({
        $queryRaw: async <TResult>() => [claimed] as TResult,
      }),
    reviewJob: {
      updateMany: async (argument: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        updates.push(argument);
        return { count: 1 };
      },
    },
  };
  const store = new PrismaReviewJobStore(prisma as never, {
    leaseDurationMilliseconds: 100,
    maximumAttempts: 2,
    retryBaseDelayMilliseconds: 1,
  });

  assert.deepEqual(await store.claimNext("worker-a"), claimed);
  assert.equal(await store.complete("job-1", "worker-a"), true);
  assert.equal(
    await store.fail("job-1", "worker-a", 1, {
      code: "HTTP_503",
      message: "retry me",
      retryable: true,
    }),
    true,
  );
  assert.equal(
    await store.fail("job-1", "worker-a", 2, {
      code: "INVALID",
      message: "terminal",
      retryable: false,
    }),
    true,
  );
  assert.equal(await store.cancel("job-1", "worker-a"), true);
  assert.equal(await store.heartbeat("job-1", "worker-a"), true);

  assert.equal(updates[0]?.data.status, "COMPLETED");
  assert.equal(updates[0]?.where.lockedBy, "worker-a");
  assert.equal(updates[1]?.data.status, "QUEUED");
  assert.equal(updates[1]?.where.attempts, 1);
  assert.ok(updates[1]?.data.runAfter instanceof Date);
  assert.equal(updates[2]?.data.status, "FAILED");
  assert.equal(updates[2]?.data.failureCode, "INVALID");
  assert.equal(updates[3]?.data.status, "COMPLETED");
  assert.ok(updates[4]?.data.leaseExpiresAt instanceof Date);
});
