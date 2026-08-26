import assert from "node:assert/strict";
import test from "node:test";

import {
  PGVECTOR_RETRIEVAL_QUERY_DESCRIPTION,
  toVectorLiteral,
} from "./pgvector-document-store.js";
import {
  buildRetrievalQuery,
  RagReviewContextProvider,
} from "./review-context-provider.js";
import type {
  EmbeddingModel,
  RepositoryDocumentSearch,
  RepositoryDocumentStore,
} from "./types.js";

class StubEmbeddingModel implements EmbeddingModel {
  queries: string[] = [];

  async embed(inputs: string[]): Promise<number[][]> {
    this.queries.push(...inputs);
    return [[0.1, 0.2, 0.3]];
  }
}

class RecordingDocumentStore implements RepositoryDocumentStore {
  query?: RepositoryDocumentSearch;

  async completeSnapshot(): Promise<void> {
    throw new Error("Not used by retrieval tests.");
  }

  async replaceDocument(): Promise<void> {
    throw new Error("Not used by retrieval tests.");
  }

  async search(query: RepositoryDocumentSearch) {
    this.query = query;
    return [
      {
        chunkIndex: 2,
        content: "Always validate webhook signatures.",
        contentSha: "content-sha",
        path: "docs/security.md",
        similarity: 0.93,
      },
    ];
  }
}

const request = {
  diff: "diff --git a/src/webhook.ts b/src/webhook.ts\n+const verified = false;",
  pullRequest: {
    baseRef: "main",
    headSha: "abc123",
    number: 42,
    repository: "octocat/ai-pr-reviewer",
  },
  ragContext: {
    branch: "main",
    repositoryId: "repository-id",
  },
};

test("embeds a bounded review query and scopes retrieval to repository, branch, and model", async () => {
  const embeddingModel = new StubEmbeddingModel();
  const store = new RecordingDocumentStore();
  const provider = new RagReviewContextProvider(embeddingModel, store, {
    embeddingModel: "text-embedding-3-small",
    retrievalLimit: 6,
  });

  const standards = await provider.getStandards(request);

  assert.deepEqual(store.query, {
    branch: "main",
    embedding: [0.1, 0.2, 0.3],
    embeddingModel: "text-embedding-3-small",
    limit: 6,
    repositoryId: "repository-id",
  });
  assert.match(embeddingModel.queries[0]!, /Pull request: #42/);
  assert.deepEqual(standards, [
    "[standard:docs/security.md#2@content-sha]\nAlways validate webhook signatures.",
  ]);
  assert.equal(toVectorLiteral([0.1, 0.2]), "[0.1,0.2]");
  assert.match(PGVECTOR_RETRIEVAL_QUERY_DESCRIPTION, /repositoryId/);
});

test("bounds the retrieval query to avoid embedding an unbounded diff", () => {
  assert.equal(
    buildRetrievalQuery({ ...request, diff: "abcdefghijkl" }, 5),
    "Repository: octocat/ai-pr-reviewer\nPull request: #42\nabcde",
  );
});
