import assert from "node:assert/strict";
import test from "node:test";

import { PrismaReviewJobStore } from "./prisma-review-job-store.js";

test("claims jobs atomically and records retry or terminal transitions idempotently", async () => {
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
    maximumAttempts: 2,
    retryBaseDelayMilliseconds: 1,
  });

  assert.deepEqual(await store.claimNext("worker-a"), claimed);
  await store.complete("job-1");
  await store.fail("job-1", 1, new Error("retry me"));
  await store.fail("job-1", 2, new Error("terminal"));
  await store.cancel("job-1");

  assert.equal(updates[0]?.data.status, "COMPLETED");
  assert.equal(updates[1]?.data.status, "QUEUED");
  assert.equal(updates[1]?.where.attempts, 1);
  assert.ok(updates[1]?.data.runAfter instanceof Date);
  assert.equal(updates[2]?.data.status, "FAILED");
  assert.equal(updates[2]?.where.attempts, 2);
  assert.equal(updates[3]?.data.status, "COMPLETED");
});
