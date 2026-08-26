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

test("claims, processes, and completes one durable job", async () => {
  const calls: string[] = [];
  const store: ReviewJobStore = {
    cancel: async () => { calls.push("cancel"); },
    claimNext: async () => job,
    complete: async () => { calls.push("complete"); },
    fail: async () => { calls.push("fail"); },
  };
  const handler: ReviewJobHandler = { process: async () => { calls.push("process"); } };

  assert.equal(await new ReviewJobWorker(store, handler, "worker-a").runOnce(), true);
  assert.deepEqual(calls, ["process", "complete"]);
});

test("records a failure for retry handling and does not complete the job", async () => {
  const calls: string[] = [];
  const store: ReviewJobStore = {
    cancel: async () => { calls.push("cancel"); },
    claimNext: async () => job,
    complete: async () => { calls.push("complete"); },
    fail: async (_id, attempt) => { calls.push(`fail-${attempt}`); },
  };
  const handler: ReviewJobHandler = { process: async () => { throw new Error("transient"); } };

  await new ReviewJobWorker(store, handler, "worker-a").runOnce();
  assert.deepEqual(calls, ["fail-1"]);
});

test("does not process when no queued job can be claimed", async () => {
  const store: ReviewJobStore = {
    cancel: async () => undefined,
    claimNext: async () => null,
    complete: async () => undefined,
    fail: async () => undefined,
  };
  const handler: ReviewJobHandler = {
    process: async () => assert.fail("handler should not run"),
  };

  assert.equal(await new ReviewJobWorker(store, handler, "worker-a").runOnce(), false);
});

test("cancels a claimed job whose webhook head was superseded", async () => {
  const calls: string[] = [];
  const store: ReviewJobStore = {
    cancel: async () => { calls.push("cancel"); },
    claimNext: async () => job,
    complete: async () => { calls.push("complete"); },
    fail: async () => { calls.push("fail"); },
  };
  const handler: ReviewJobHandler = {
    process: async () => "cancelled",
  };

  assert.equal(await new ReviewJobWorker(store, handler, "worker-a").runOnce(), true);
  assert.deepEqual(calls, ["cancel"]);
});
