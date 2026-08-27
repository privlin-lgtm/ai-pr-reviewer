import assert from "node:assert/strict";
import test from "node:test";

import { RepositoryIndexQueue } from "./repository-index-queue.js";

test("requeues a completed or failed repository index with durable status metadata", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const transaction = {
    repository: {
      findUnique: async () => ({
        defaultBranch: "main",
        id: "repository-1",
        installation: { githubInstallationId: 99n },
        isEnabled: true,
        name: "repo",
        ownerLogin: "octocat",
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return {};
      },
    },
    repositoryIndexJob: {
      findUnique: async () => ({ force: false, id: "index-job-1", status: "FAILED" }),
      upsert: async ({ create, update }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        assert.equal(create.status, "QUEUED");
        assert.equal(update.status, "QUEUED");
        return { id: "index-job-1" };
      },
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
      callback(transaction),
  };

  const result = await new RepositoryIndexQueue(prisma as never).enqueue({
    force: true,
    repositoryId: "repository-1",
  });

  assert.deepEqual(result, { jobId: "index-job-1", scheduled: true });
  assert.equal(updates[0]?.indexStatus, "QUEUED");
});
