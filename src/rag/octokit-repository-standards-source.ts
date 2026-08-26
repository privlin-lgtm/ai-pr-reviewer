import { App } from "@octokit/app";

import { DocumentExtractionError } from "./errors.js";
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
    private readonly retryOptions: RetryOptions = {},
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
    this.retryOptions);

    const paths = selectIndexablePaths(extractBlobPaths(readResponseData(treeResponse)));
    return Promise.all(
      paths.map(async (path) => {
        const response = await retryTransient(() =>
          octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
            owner: target.owner,
            repo: target.repository,
            path,
            ref: target.branch,
          }),
        this.retryOptions);

        return decodeRepositoryDocument(path, readResponseData(response));
      }),
    );
  }
}

function extractBlobPaths(data: unknown): string[] {
  if (!isRecord(data) || !Array.isArray(data["tree"])) {
    throw new Error("GitHub tree response is invalid.");
  }

  return data["tree"].flatMap((entry) => {
    if (!isRecord(entry) || entry["type"] !== "blob" || typeof entry["path"] !== "string") {
      return [];
    }

    return [entry["path"]];
  });
}

function decodeRepositoryDocument(path: string, data: unknown): RepositoryDocumentSource {
  if (!isRecord(data)) {
    throw new DocumentExtractionError(path, "GitHub contents response is invalid.");
  }

  const content = data["content"];
  const encoding = data["encoding"];
  const sha = data["sha"];
  if (typeof content !== "string" || encoding !== "base64" || typeof sha !== "string") {
    throw new DocumentExtractionError(path, "GitHub did not return a base64 text document.");
  }

  return {
    content: Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8"),
    path,
    sha,
  };
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
