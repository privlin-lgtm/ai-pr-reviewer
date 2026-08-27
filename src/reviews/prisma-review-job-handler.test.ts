import assert from "node:assert/strict";
import test from "node:test";

import { PrismaReviewJobHandler } from "./prisma-review-job-handler.js";

test("cancels a stale claimed head before analysis or persistence", async () => {
  let analyzed = false;
  const pullRequests = {
    fetchDiff: async () => ({ content: "diff", installationId: 1, owner: "octocat", pullNumber: 2, repository: "repo" }),
    fetchMetadata: async () => ({
      authorGithubLogin: "octocat",
      authorGithubUserId: 1,
      baseRef: "main",
      baseSha: "base",
      body: null,
      closedAt: null,
      createdAt: new Date(),
      githubPullRequestId: 3,
      headRef: "feature",
      headSha: "newer-head",
      installationId: 1,
      isDraft: false,
      mergedAt: null,
      owner: "octocat",
      pullNumber: 2,
      repository: "repo",
      state: "OPEN" as const,
      title: "PR",
      updatedAt: new Date(),
    }),
    findPublishedReviewByMarker: async () => null,
    listChangedFiles: async () => [],
    publishReview: async () => assert.fail("stale jobs must not publish"),
  };
  const handler = new PrismaReviewJobHandler(
    {} as never,
    pullRequests,
    {
      analyzeDiff: async () => {
        analyzed = true;
        throw new Error("not reached");
      },
    } as never,
    { modelName: "test" },
  );

  assert.equal(
    await handler.process({
      attempts: 1,
      headSha: "old-head",
      id: "job-1",
      installationGithubId: 1n,
      owner: "octocat",
      pullRequestNumber: 2,
      repositoryGithubId: 3n,
      repositoryName: "repo",
    }),
    "cancelled",
  );
  assert.equal(analyzed, false);
});
