import { App } from "@octokit/app";

import {
  DocumentExtractionError,
  RepositoryDocumentLimitError,
  RepositoryDocumentSizeLimitError,
  RepositoryTreeTruncatedError,
} from "./errors.js";
import { selectIndexablePaths } from "./document-paths.js";
import { retryTransient, type RetryOptions } from "../github/retry.js";
import type {
  RepositoryDocumentSource,
  RepositoryStandardsSource,
  RepositoryStandardsTarget,
} from "./types.js";

export class OctokitRepositoryStandardsSource implements RepositoryStandardsSource {
  constructor(
    private readonly app: App,
    private readonly options: RepositoryStandardsSourceOptions = {},
  ) {}

  async listDocuments(target: RepositoryStandardsTarget): Promise<RepositoryDocumentSource[]> {
    const octokit = await this.app.getInstallationOctokit(target.installationId);
    const treeResponse = await retryTransient(() =>
      octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
        owner: target.owner,
        repo: target.repository,
        tree_sha: target.branch,
        recursive: "1",
      }),
    this.options.retryOptions);

    const paths = selectIndexablePaths(extractBlobPaths(readResponseData(treeResponse)));
    const maxDocuments = this.options.maxDocuments ?? 200;
    if (paths.length > maxDocuments) {
      throw new RepositoryDocumentLimitError(maxDocuments);
    }

    return mapWithConcurrency(
      paths,
      this.options.concurrency ?? 8,
      async (path) => {
        const response = await retryTransient(() =>
          octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
            owner: target.owner,
            repo: target.repository,
            path,
            ref: target.branch,
          }),
        this.options.retryOptions);

        return decodeRepositoryDocument(
          path,
          readResponseData(response),
          this.options.maxDocumentBytes ?? 262_144,
        );
      },
    );
  }
}

function extractBlobPaths(data: unknown): string[] {
  if (!isRecord(data) || !Array.isArray(data["tree"])) {
    throw new Error("GitHub tree response is invalid.");
  }
  if (data["truncated"] === true) {
    throw new RepositoryTreeTruncatedError();
  }

  return data["tree"].flatMap((entry) => {
    if (!isRecord(entry) || entry["type"] !== "blob" || typeof entry["path"] !== "string") {
      return [];
    }

    return [entry["path"]];
  });
}

function decodeRepositoryDocument(
  path: string,
  data: unknown,
  maximumBytes: number,
): RepositoryDocumentSource {
  if (!isRecord(data)) {
    throw new DocumentExtractionError(path, "GitHub contents response is invalid.");
  }

  const content = data["content"];
  const encoding = data["encoding"];
  const sha = data["sha"];
  if (typeof content !== "string" || encoding !== "base64" || typeof sha !== "string") {
    throw new DocumentExtractionError(path, "GitHub did not return a base64 text document.");
  }

  const decoded = Buffer.from(content.replace(/\n/g, ""), "base64");
  if (decoded.byteLength > maximumBytes) {
    throw new RepositoryDocumentSizeLimitError(path, maximumBytes);
  }

  return {
    content: decoded.toString("utf8"),
    path,
    sha,
  };
}

export interface RepositoryStandardsSourceOptions {
  concurrency?: number;
  maxDocumentBytes?: number;
  maxDocuments?: number;
  retryOptions?: RetryOptions;
}

export async function mapWithConcurrency<T, TResult>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<TResult>,
): Promise<TResult[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer.");
  }

  const results: TResult[] = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  });

  await Promise.all(workers);
  return results;
}

function readResponseData(response: unknown): unknown {
  if (!isRecord(response) || !("data" in response)) {
    throw new Error("GitHub API response does not contain data.");
  }

  return response["data"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
