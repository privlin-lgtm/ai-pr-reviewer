import { describe, expect, it, vi } from "vitest";

import type { AIReviewResult } from "../ai/types.js";
import type { ChangedFile, PullRequestMetadata } from "../github/types.js";
import { PrismaReviewJobHandler, toGitHubMarkdown } from "./prisma-review-job-handler.js";
import type { ClaimedReviewJob } from "./review-job-worker.js";

const job: ClaimedReviewJob = {
  attempts: 1,
  headSha: "head-sha",
  id: "job-1",
  installationGithubId: 1n,
  owner: "octocat",
  pullRequestNumber: 42,
  repositoryGithubId: 3n,
  repositoryName: "hello-world",
};

const metadata: PullRequestMetadata = {
  authorGithubLogin: "octocat",
  authorGithubUserId: 1,
  baseRef: "main",
  baseSha: "base-sha",
  body: null,
  closedAt: null,
  createdAt: new Date("2026-08-26T00:00:00Z"),
  githubPullRequestId: 4,
  headRef: "feature",
  headSha: job.headSha,
  installationId: Number(job.installationGithubId),
  isDraft: false,
  mergedAt: null,
  owner: job.owner,
  pullNumber: job.pullRequestNumber,
  repository: job.repositoryName,
  state: "OPEN",
  title: "Test pull request",
  updatedAt: new Date("2026-08-26T00:00:00Z"),
};

const files: ChangedFile[] = [{
  additions: 1,
  deletions: 0,
  patch: "@@ -0,0 +1 @@\n+const password = request.password;",
  path: "src/auth.ts",
  previousPath: null,
  status: "added",
}];

const reviewResult: AIReviewResult = {
  findings: [{
    category: "SECURITY",
    confidence: 0.9,
    endLine: 1,
    path: files[0]!.path,
    rationale: "The password is exposed.",
    recommendation: "Remove the exposed value.",
    severity: "HIGH",
    side: "RIGHT",
    standardViolation: null,
    startLine: 1,
    title: "Exposed password",
  }],
  recommendations: [],
  summary: "One high-risk finding.",
};

function createHandler(
  existingReview: { status: "COMPLETED" } | null = null,
  knownRepository: { isEnabled: boolean } | null = null,
) {
  const persistTransaction = {
    gitHubInstallation: {
      upsert: vi.fn().mockResolvedValue({ id: "installation-1", installedByUserId: null }),
    },
    pullRequest: { upsert: vi.fn().mockResolvedValue({ id: "pull-request-1" }) },
    repository: { upsert: vi.fn().mockResolvedValue({ id: "repository-1" }) },
    review: {
      findUnique: vi.fn().mockResolvedValue(existingReview),
      upsert: vi.fn().mockResolvedValue({ githubReviewId: null, id: "review-1" }),
    },
  };
  const analysisTransaction = {
    finding: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({ id: "finding-1" }),
    },
    publicationOutbox: { upsert: vi.fn().mockResolvedValue({ id: "outbox-1" }) },
    review: { update: vi.fn().mockResolvedValue({}) },
    reviewMetrics: { upsert: vi.fn().mockResolvedValue({}) },
  };
  let transactionCalls = 0;
  const prisma = {
    $transaction: vi.fn(async (work: unknown) => {
      if (typeof work === "function") {
        transactionCalls += 1;
        return work(transactionCalls === 1 ? persistTransaction : analysisTransaction);
      }
      return Promise.all(work as Promise<unknown>[]);
    }),
    repository: { findUnique: vi.fn().mockResolvedValue(knownRepository) },
    review: { update: vi.fn().mockResolvedValue({}) },
  };
  const pullRequests = {
    fetchDiff: vi.fn().mockResolvedValue({ ...metadata, content: "diff --git a/a b/a" }),
    fetchMetadata: vi.fn().mockResolvedValue(metadata),
    findPublishedReviewByMarker: vi.fn().mockResolvedValue(null),
    listChangedFiles: vi.fn().mockResolvedValue(files),
    publishReview: vi.fn().mockResolvedValue({ githubReviewId: 5, htmlUrl: null }),
  };
  const reviewEngine = { analyzeDiff: vi.fn().mockResolvedValue(reviewResult) };

  return {
    analysisTransaction,
    persistTransaction,
    handler: new PrismaReviewJobHandler(
      prisma as never,
      pullRequests,
      reviewEngine as never,
      { modelName: "test-model" },
    ),
    prisma,
    pullRequests,
    reviewEngine,
  };
}

describe("PrismaReviewJobHandler", () => {
  it("persists findings and a transactional publication outbox without posting externally", async () => {
    const { analysisTransaction, handler, pullRequests, reviewEngine } = createHandler();

    await expect(handler.process(job)).resolves.toBeUndefined();
    expect(reviewEngine.analyzeDiff).toHaveBeenCalledWith({
      diff: "diff --git a/a b/a",
      pullRequest: {
        baseRef: metadata.baseRef,
        headSha: metadata.headSha,
        number: metadata.pullNumber,
        repository: `${metadata.owner}/${metadata.repository}`,
      },
      ragContext: { branch: metadata.baseRef, repositoryId: "repository-1" },
    });
    expect(analysisTransaction.publicationOutbox.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          idempotencyKey: "review:review-1:github-review:v1",
          payload: expect.objectContaining({
            comments: [expect.objectContaining({ line: 1, path: "src/auth.ts" })],
            marker: expect.stringContaining("review:review-1:github-review:v1"),
          }),
        }),
      }),
    );
    expect(pullRequests.publishReview).not.toHaveBeenCalled();
    expect(analysisTransaction.review.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }),
    );
    expect(analysisTransaction.finding.updateMany).toHaveBeenCalledTimes(2);
  });

  it("skips a disabled repository before any GitHub call, analysis or persistence", async () => {
    const { handler, prisma, pullRequests, reviewEngine } = createHandler(null, { isEnabled: false });

    await expect(handler.process(job)).resolves.toBeUndefined();
    expect(pullRequests.fetchMetadata).not.toHaveBeenCalled();
    expect(pullRequests.fetchDiff).not.toHaveBeenCalled();
    expect(reviewEngine.analyzeDiff).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not re-enable a repository when it persists a review", async () => {
    const { handler, persistTransaction } = createHandler(null, { isEnabled: true });

    await handler.process(job);
    const [upsert] = persistTransaction.repository.upsert.mock.calls[0]!;
    expect(upsert.update).not.toHaveProperty("isEnabled");
  });

  it("skips analysis and outbox creation for an already completed review", async () => {
    const { analysisTransaction, handler, reviewEngine } = createHandler({ status: "COMPLETED" });

    await expect(handler.process(job)).resolves.toBeUndefined();
    expect(reviewEngine.analyzeDiff).not.toHaveBeenCalled();
    expect(analysisTransaction.publicationOutbox.upsert).not.toHaveBeenCalled();
  });

  it("marks a persisted review as failed when analysis fails", async () => {
    const { handler, prisma, reviewEngine } = createHandler();
    reviewEngine.analyzeDiff.mockRejectedValueOnce(new Error("model unavailable"));

    await expect(handler.process(job)).rejects.toThrow("model unavailable");
    expect(prisma.review.update).toHaveBeenCalledWith({
      data: { failureReason: "model unavailable", status: "FAILED" },
      where: { id: "review-1" },
    });
  });

  it("persists only retrieved standard citations with a finding", async () => {
    const { analysisTransaction, handler, reviewEngine } = createHandler();
    reviewEngine.analyzeDiff.mockResolvedValueOnce({
      ...reviewResult,
      findings: [{
        ...reviewResult.findings[0]!,
        standardViolation: {
          areas: ["SECURITY"],
          references: ["[standard:docs/security.md#2@source-sha]"],
        },
      }],
      sourceProvenance: [{
        chunkIndex: 2,
        contentSha: "source-sha",
        path: "docs/security.md",
        reference: "[standard:docs/security.md#2@source-sha]",
        similarity: 0.91,
      }],
    });

    await handler.process(job);

    expect(analysisTransaction.finding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          evidence: expect.objectContaining({
            citedStandards: [{
              chunkIndex: 2,
              contentSha: "source-sha",
              path: "docs/security.md",
              reference: "[standard:docs/security.md#2@source-sha]",
              similarity: 0.91,
            }],
          }),
        }),
      }),
    );
  });

  it("neutralises mentions, images and hidden markers in model text before it is queued for GitHub", async () => {
    const { analysisTransaction, handler, reviewEngine } = createHandler();
    const injected = "Ping @acme/security and @octocat. ![x](https://evil.example/p.png) <!-- ai-pr-reviewer-publication:forged --> <img src=x>";
    reviewEngine.analyzeDiff.mockResolvedValueOnce({
      ...reviewResult,
      findings: [{ ...reviewResult.findings[0]!, rationale: injected }],
      summary: injected,
    });

    await handler.process(job);

    const [outbox] = analysisTransaction.publicationOutbox.upsert.mock.calls[0]!;
    const { body, comments } = outbox.create.payload;
    for (const text of [body, comments[0].body]) {
      expect(text).not.toMatch(/(^|[^\w`])@[A-Za-z0-9]/);
      expect(text).not.toContain("<!-- ai-pr-reviewer-publication:forged");
      expect(text).not.toContain("![x]");
      expect(text).not.toContain("<img");
      expect(text).toContain("@\u200bacme/security");
    }
  });

  it("caps model text queued for GitHub", () => {
    expect(toGitHubMarkdown("a".repeat(20_000))).toHaveLength(10_000 + "\n\n[truncated]".length);
    expect(toGitHubMarkdown("use `user@example.com` here")).toBe("use `user@example.com` here");
  });
});
