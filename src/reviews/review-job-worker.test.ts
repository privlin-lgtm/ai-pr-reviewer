import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewJobWorker,
  type ClaimedReviewJob,
  type ReviewJobHandler,
  type ReviewJobStore,
} from "./review-job-worker.js";

const job: ClaimedReviewJob = {
  attempts: 1,
  headSha: "abc",
  id: "job-1",
  installationGithubId: 1n,
  owner: "octocat",
  pullRequestNumber: 1,
  repositoryGithubId: 2n,
  repositoryName: "repo",
};

function createStore(
  overrides: Partial<ReviewJobStore> = {},
): ReviewJobStore {
  return {
    cancel: async () => true,
    claimNext: async () => job,
    complete: async () => true,
    fail: async () => true,
    heartbeat: async () => true,
    ...overrides,
  };
}

test("claims, heartbeats, processes, and completes one durable job", async () => {
  const calls: string[] = [];
  const store = createStore({
    complete: async (_id, workerId) => {
      calls.push(`complete-${workerId}`);
      return true;
    },
    heartbeat: async () => {
      calls.push("heartbeat");
      return true;
    },
  });
  const handler: ReviewJobHandler = {
    process: async () => {
      calls.push("process");
    },
  };

  assert.equal(await new ReviewJobWorker(store, handler, "worker-a").runOnce(), true);
  assert.deepEqual(calls, ["process", "heartbeat", "complete-worker-a"]);
});

test("classifies and records a failure for retry handling", async () => {
  const calls: string[] = [];
  const store = createStore({
    fail: async (_id, workerId, attempt, failure) => {
      calls.push(`${workerId}-${attempt}-${failure.code}-${failure.retryable}`);
      return true;
    },
  });
  const handler: ReviewJobHandler = {
    process: async () => {
      throw Object.assign(new Error("temporarily unavailable"), { status: 503 });
    },
  };

  await new ReviewJobWorker(store, handler, "worker-a").runOnce();
  assert.deepEqual(calls, ["worker-a-1-HTTP_503-true"]);
});

test("does not process when no queued job can be claimed", async () => {
  const store = createStore({ claimNext: async () => null });
  const handler: ReviewJobHandler = {
    process: async () => assert.fail("handler should not run"),
  };

  assert.equal(await new ReviewJobWorker(store, handler, "worker-a").runOnce(), false);
});

test("cancels a claimed job whose webhook head was superseded", async () => {
  const calls: string[] = [];
  const store = createStore({
    cancel: async () => {
      calls.push("cancel");
      return true;
    },
    heartbeat: async () => {
      calls.push("heartbeat");
      return true;
    },
  });
  const handler: ReviewJobHandler = {
    process: async () => "cancelled",
  };

  assert.equal(await new ReviewJobWorker(store, handler, "worker-a").runOnce(), true);
  assert.deepEqual(calls, ["heartbeat", "cancel"]);
});

test("does not transition a job after its lease is lost", async () => {
  const calls: string[] = [];
  const store = createStore({
    complete: async () => {
      calls.push("complete");
      return true;
    },
    heartbeat: async () => false,
  });

  await new ReviewJobWorker(store, { process: async () => undefined }, "worker-a").runOnce();
  assert.deepEqual(calls, []);
});
