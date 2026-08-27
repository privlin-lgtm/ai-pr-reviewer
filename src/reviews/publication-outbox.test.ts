import assert from "node:assert/strict";
import test from "node:test";

import {
  GitHubReviewOutboxPublisher,
  PublicationOutboxWorker,
  publicationMarker,
  type ClaimedPublicationOutbox,
  type PublicationOutboxStore,
} from "./publication-outbox.js";

const outbox: ClaimedPublicationOutbox = {
  attempts: 1,
  id: "outbox-1",
  idempotencyKey: "review:review-1:github-review:v1",
  payload: {
    body: "## AI review",
    comments: [],
    commitSha: "abc",
    event: "COMMENT",
    marker: publicationMarker("review:review-1:github-review:v1"),
    target: {
      installationId: 1,
      owner: "octocat",
      pullNumber: 2,
      repository: "repo",
    },
    version: 1,
  },
  reviewId: "review-1",
};

test("uses the persisted marker to avoid reposting a review after a crash", async () => {
  let publishCalls = 0;
  const publisher = new GitHubReviewOutboxPublisher({
    fetchDiff: async () => assert.fail("not used"),
    fetchMetadata: async () => assert.fail("not used"),
    findPublishedReviewByMarker: async (_target, marker) => {
      assert.equal(marker, (outbox.payload as { marker: string }).marker);
      return { githubReviewId: 99, htmlUrl: "https://github.example/review/99" };
    },
    listChangedFiles: async () => assert.fail("not used"),
    publishReview: async () => {
      publishCalls += 1;
      return { githubReviewId: 100, htmlUrl: null };
    },
  });

  const published = await publisher.publish(outbox);
  assert.equal(published.githubReviewId, 99);
  assert.equal(publishCalls, 0);
});

test("marks an owned publication as complete only after the publisher returns", async () => {
  const calls: string[] = [];
  const store: PublicationOutboxStore = {
    claimNext: async () => outbox,
    complete: async (claimed, workerId, published) => {
      calls.push(`${claimed.id}:${workerId}:${published.githubReviewId}`);
      return true;
    },
    fail: async () => {
      calls.push("fail");
      return true;
    },
    heartbeat: async () => true,
  };
  const publisher = { publish: async () => ({ githubReviewId: 17, htmlUrl: null }) };

  assert.equal(
    await new PublicationOutboxWorker(store, publisher, "worker-a").runOnce(),
    true,
  );
  assert.deepEqual(calls, ["outbox-1:worker-a:17"]);
});

test("records a terminal payload-validation failure without publishing", async () => {
  let failure: { code: string; retryable: boolean } | undefined;
  const store: PublicationOutboxStore = {
    claimNext: async () => ({ ...outbox, payload: {} }),
    complete: async () => assert.fail("invalid payload must not complete"),
    fail: async (_id, _worker, _attempt, value) => {
      failure = value;
      return true;
    },
    heartbeat: async () => true,
  };
  const publisher = new GitHubReviewOutboxPublisher({
    fetchDiff: async () => assert.fail("not used"),
    fetchMetadata: async () => assert.fail("not used"),
    findPublishedReviewByMarker: async () => assert.fail("not used"),
    listChangedFiles: async () => assert.fail("not used"),
    publishReview: async () => assert.fail("not used"),
  });

  await new PublicationOutboxWorker(store, publisher, "worker-a").runOnce();
  assert.equal(failure?.code, "InvalidPublicationPayloadError");
  assert.equal(failure?.retryable, false);
});
