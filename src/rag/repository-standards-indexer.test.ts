import assert from "node:assert/strict";
import test from "node:test";

import {
  RepositoryDocumentLimitError,
  RepositoryTreeTruncatedError,
} from "./errors.js";
import {
  mapWithConcurrency,
  OctokitRepositoryStandardsSource,
} from "./octokit-repository-standards-source.js";
import { RepositoryStandardsIndexer } from "./repository-standards-indexer.js";
import type {
  EmbeddedRepositoryDocument,
  RepositoryDocumentStore,
  RepositoryStandardsSource,
} from "./types.js";

const target = {
  branch: "main",
  installationId: 1,
  owner: "octocat",
  repository: "repo",
  repositoryId: "repository-id",
};

test("rejects truncated repository trees before indexing a partial standards snapshot", async () => {
  const source = new OctokitRepositoryStandardsSource({
    getInstallationOctokit: async () => ({
      request: async () => ({ data: { tree: [], truncated: true } }),
    }),
  } as never);

  await assert.rejects(source.listDocuments(target), RepositoryTreeTruncatedError);
});

test("enforces the selected document limit before fetching document content", async () => {
  let contentRequests = 0;
  const source = new OctokitRepositoryStandardsSource({
    getInstallationOctokit: async () => ({
      request: async (route: string) => {
        if (route.includes("/git/trees/")) {
          return {
            data: {
              tree: [
                { path: "README.md", type: "blob" },
                { path: "CONTRIBUTING.md", type: "blob" },
              ],
              truncated: false,
            },
          };
        }
        contentRequests += 1;
        return { data: {} };
      },
    }),
  } as never, { maxDocuments: 1 });

  await assert.rejects(source.listDocuments(target), RepositoryDocumentLimitError);
  assert.equal(contentRequests, 0);
});

test("bounds concurrent standards document work while preserving path order", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test("cleans stale standards only after all replacement documents succeed", async () => {
  const source: RepositoryStandardsSource = {
    listDocuments: async () => [
      { content: "One", path: "README.md", sha: "one" },
      { content: "Two", path: "CONTRIBUTING.md", sha: "two" },
    ],
  };
  let snapshotCompleted = false;
  let completedPaths: string[] = [];
  let replacements = 0;
  const store: RepositoryDocumentStore = {
    completeSnapshot: async () => { snapshotCompleted = true; },
    replaceDocument: async () => {
      replacements += 1;
      if (replacements === 2) {
        throw new Error("embedding write failed");
      }
    },
    search: async () => [],
  };
  const embeddingModel = { embed: async (inputs: string[]) => inputs.map(() => [0.1]) };
  const indexer = new RepositoryStandardsIndexer(source, embeddingModel, store, {
    embeddingDimensions: 1,
    embeddingModel: "test",
  });

  await assert.rejects(indexer.index(target), /embedding write failed/);
  assert.equal(snapshotCompleted, false);

  const successfulStore: RepositoryDocumentStore = {
    completeSnapshot: async (scope) => {
      snapshotCompleted = true;
      completedPaths = scope.paths;
    },
    replaceDocument: async (_document: EmbeddedRepositoryDocument) => undefined,
    search: async () => [],
  };
  const successfulIndexer = new RepositoryStandardsIndexer(
    source,
    embeddingModel,
    successfulStore,
    { embeddingDimensions: 1, embeddingModel: "test" },
  );
  await successfulIndexer.index(target);
  assert.equal(snapshotCompleted, true);
  assert.deepEqual(completedPaths, ["README.md", "CONTRIBUTING.md"]);
});
