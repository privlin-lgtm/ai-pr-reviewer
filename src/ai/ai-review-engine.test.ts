import assert from "node:assert/strict";
import test from "node:test";

import { AIReviewEngine } from "./ai-review-engine.js";
import {
  DiffTooLargeError,
  InvalidAIReviewInputError,
  InvalidAIReviewResponseError,
  OpenAIReviewRequestError,
} from "./errors.js";
import { toPrismaFindingDraft, type StructuredReviewModel } from "./types.js";

class StubReviewModel implements StructuredReviewModel {
  calls = 0;

  constructor(private readonly responses: Array<string | unknown>) {}

  async complete(): Promise<string> {
    this.calls += 1;
    const response = this.responses.shift();
    if (typeof response === "string") {
      return response;
    }

    throw response;
  }
}

const request = {
  diff: "diff --git a/src/example.ts b/src/example.ts\n+@@ -1 +1 @@\n-const enabled = false;\n++const enabled = true;",
  pullRequest: {
    baseRef: "main",
    headSha: "abc123",
    number: 42,
    repository: "octocat/ai-pr-reviewer",
  },
};

const validResponse = JSON.stringify({
  summary: "One authorization concern was found.",
  findings: [
    {
      category: "SECURITY",
      confidence: 0.92,
      endLine: 1,
      path: "src/example.ts",
      rationale: "Enabling this branch bypasses authorization.",
      recommendation: "Guard the branch with an authorization check.",
      severity: "HIGH",
      side: "RIGHT",
      startLine: 1,
      title: "Authorization bypass",
    },
  ],
  recommendations: [
    {
      detail: "Add a regression test for unauthorized access.",
      priority: "MEDIUM",
      relatedPaths: ["src/example.ts"],
      title: "Cover authorization behavior",
    },
  ],
});

test("returns Zod-validated findings that map to Prisma Finding fields", async () => {
  const engine = new AIReviewEngine(new StubReviewModel([validResponse]), {
    model: "test-model",
  });

  const result = await engine.analyzeDiff(request);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(toPrismaFindingDraft(result.findings[0]!), {
    category: "SECURITY",
    confidence: 0.92,
    endLine: 1,
    evidence: { source: "openai" },
    path: "src/example.ts",
    rationale: "Enabling this branch bypasses authorization.",
    severity: "HIGH",
    side: "RIGHT",
    startLine: 1,
    status: "PENDING",
    suggestedFix: "Guard the branch with an authorization check.",
    title: "Authorization bypass",
  });
});

test("retries transient OpenAI failures with bounded injected delays", async () => {
  const model = new StubReviewModel([{ status: 429 }, validResponse]);
  const delays: number[] = [];
  const engine = new AIReviewEngine(model, {
    model: "test-model",
    retryOptions: {
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
    },
  });

  await engine.analyzeDiff(request);

  assert.equal(model.calls, 2);
  assert.deepEqual(delays, [250]);
});

test("rejects invalid structured responses and bounds diff input", async () => {
  const invalidEngine = new AIReviewEngine(new StubReviewModel(["not-json"]), {
    model: "test-model",
  });

  await assert.rejects(invalidEngine.analyzeDiff(request), InvalidAIReviewResponseError);

  const boundedEngine = new AIReviewEngine(new StubReviewModel([validResponse]), {
    maximumDiffCharacters: 1,
    model: "test-model",
  });

  await assert.rejects(boundedEngine.analyzeDiff(request), DiffTooLargeError);

  await assert.rejects(
    boundedEngine.analyzeDiff({ ...request, diff: "" }),
    InvalidAIReviewInputError,
  );

  const failedEngine = new AIReviewEngine(new StubReviewModel([{ status: 400 }]), {
    model: "test-model",
    retryOptions: { delay: async () => undefined },
  });

  await assert.rejects(failedEngine.analyzeDiff(request), OpenAIReviewRequestError);
});
