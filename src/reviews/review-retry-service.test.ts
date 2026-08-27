import assert from "node:assert/strict";
import test from "node:test";

import { ReviewRetryService } from "./review-retry-service.js";

test("does not replace an active retry job with a duplicate", async () => {
  let upsertCalled = false;
  const transaction = {
    review: {
      findUnique: async () => ({
        headSha: "head",
        id: "review-1",
        pullRequest: {
          number: 42,
          repository: {
            githubRepositoryId: 3n,
            installation: { githubInstallationId: 1n },
            name: "repo",
            ownerLogin: "octocat",
          },
        },
        status: "FAILED",
      }),
    },
    reviewJob: {
      findUnique: async () => ({ id: "active-job", status: "PROCESSING" }),
      upsert: async () => {
        upsertCalled = true;
        return { id: "new-job" };
      },
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
      callback(transaction),
  };

  assert.deepEqual(await new ReviewRetryService(prisma as never).retry("review-1"), {
    jobId: "active-job",
  });
  assert.equal(upsertCalled, false);
});
