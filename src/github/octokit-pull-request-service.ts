import { App } from "@octokit/app";

import { ChangedFileLimitExceededError } from "./errors.js";
import { retryTransient, type RetryOptions } from "./retry.js";
import type {
  ChangedFile,
  GitHubPullRequestService,
  PublishedReview,
  PullRequestDiff,
  PullRequestMetadata,
  PullRequestTarget,
  ReviewCommentInput,
  ReviewSubmission,
} from "./types.js";

const DEFAULT_MAXIMUM_CHANGED_FILES = 3_000;
const MAXIMUM_REVIEW_LOOKUP_PAGES = 10;

export class OctokitPullRequestService implements GitHubPullRequestService {
  constructor(
    private readonly app: App,
    private readonly retryOptions: RetryOptions = {},
  ) {}

  async fetchDiff(target: PullRequestTarget): Promise<PullRequestDiff> {
    const octokit = await this.getInstallationOctokit(target.installationId);
    const response = await this.run(() =>
      octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner: target.owner,
        repo: target.repository,
        pull_number: target.pullNumber,
        headers: {
          accept: "application/vnd.github.v3.diff",
        },
      }),
    );

    const data = readResponseData(response);
    if (typeof data !== "string") {
      throw new Error("GitHub did not return a unified pull request diff.");
    }

    return { ...target, content: data };
  }

  async fetchMetadata(target: PullRequestTarget): Promise<PullRequestMetadata> {
    const octokit = await this.getInstallationOctokit(target.installationId);
    const response = await this.run(() =>
      octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner: target.owner,
        repo: target.repository,
        pull_number: target.pullNumber,
      }),
    );

    return toPullRequestMetadata(target, readResponseData(response));
  }

  async listChangedFiles(
    target: PullRequestTarget,
    maximumFiles = DEFAULT_MAXIMUM_CHANGED_FILES,
  ): Promise<ChangedFile[]> {
    if (!Number.isInteger(maximumFiles) || maximumFiles < 1) {
      throw new RangeError("maximumFiles must be a positive integer.");
    }

    const octokit = await this.getInstallationOctokit(target.installationId);
    const files: ChangedFile[] = [];

    for (let page = 1; ; page += 1) {
      const remaining = maximumFiles - files.length;
      if (remaining === 0) {
        throw new ChangedFileLimitExceededError(maximumFiles);
      }

      const perPage = Math.min(100, remaining);
      const response = await this.run(() =>
        octokit.request(
          "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
          {
          owner: target.owner,
          repo: target.repository,
          pull_number: target.pullNumber,
          page,
          per_page: perPage,
          },
        ),
      );

      const pageFiles = toChangedFiles(readResponseData(response));
      files.push(...pageFiles);
      if (pageFiles.length < perPage) {
        return files;
      }
    }
  }

  async findPublishedReviewByMarker(
    target: PullRequestTarget,
    marker: string,
  ): Promise<PublishedReview | null> {
    if (marker.trim().length === 0) {
      throw new RangeError("A publication marker is required.");
    }

    const octokit = await this.getInstallationOctokit(target.installationId);
    for (let page = 1; page <= MAXIMUM_REVIEW_LOOKUP_PAGES; page += 1) {
      const response = await this.run(() =>
        octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
          owner: target.owner,
          page,
          per_page: 100,
          pull_number: target.pullNumber,
          repo: target.repository,
        }),
      );
      const reviews = readReviewList(readResponseData(response));
      const match = reviews.find((review) => review.body?.includes(marker));
      if (match !== undefined) {
        return {
          githubReviewId: match.id,
          htmlUrl: match.htmlUrl,
        };
      }
      if (reviews.length < 100) {
        return null;
      }
    }

    return null;
  }

  async publishReview(submission: ReviewSubmission): Promise<PublishedReview> {
    const octokit = await this.getInstallationOctokit(submission.installationId);
    const response = await this.run(() =>
      octokit.request(
        "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
        {
          owner: submission.owner,
          repo: submission.repository,
          pull_number: submission.pullNumber,
          commit_id: submission.commitSha,
          body: submission.body,
          event: submission.event,
          comments: submission.comments.map(toGitHubReviewComment),
        },
      ),
    );

    return toPublishedReview(readResponseData(response));
  }

  private async getInstallationOctokit(installationId: number) {
    return this.app.getInstallationOctokit(installationId);
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    return retryTransient(operation, this.retryOptions);
  }
}

function toChangedFiles(data: unknown): ChangedFile[] {
  if (!Array.isArray(data)) {
    throw new Error("GitHub changed-files response is not an array.");
  }

  return data.map((file) => toChangedFile(file));
}

function toPullRequestMetadata(
  target: PullRequestTarget,
  data: unknown,
): PullRequestMetadata {
  if (!isRecord(data)) {
    throw new Error("GitHub pull request response is not an object.");
  }

  const base = readObject(data, "base");
  const head = readObject(data, "head");
  const user = readObject(data, "user");
  const state = readString(data, "state");
  const merged = data["merged"] === true;
  return {
    ...target,
    authorGithubLogin: readString(user, "login"),
    authorGithubUserId: readOptionalInteger(user, "id") ?? null,
    baseRef: readString(base, "ref"),
    baseSha: readString(base, "sha"),
    body: readOptionalString(data, "body") ?? null,
    closedAt: readOptionalDate(data, "closed_at"),
    createdAt: readDate(data, "created_at"),
    githubPullRequestId: readInteger(data, "id"),
    headRef: readString(head, "ref"),
    headSha: readString(head, "sha"),
    isDraft: data["draft"] === true,
    mergedAt: readOptionalDate(data, "merged_at"),
    state: merged ? "MERGED" : toPullRequestState(state),
    title: readString(data, "title"),
    updatedAt: readDate(data, "updated_at"),
  };
}

function toPullRequestState(state: string): PullRequestMetadata["state"] {
  if (state === "open") {
    return "OPEN";
  }
  if (state === "closed") {
    return "CLOSED";
  }
  throw new Error(`GitHub returned an unsupported pull request state: ${state}`);
}

function toChangedFile(value: unknown): ChangedFile {
  if (!isRecord(value)) {
    throw new Error("GitHub changed-files response contains an invalid file.");
  }

  return {
    additions: readInteger(value, "additions"),
    deletions: readInteger(value, "deletions"),
    patch: readOptionalString(value, "patch") ?? null,
    path: readString(value, "filename"),
    previousPath: readOptionalString(value, "previous_filename") ?? null,
    status: toChangedFileStatus(readString(value, "status")),
  };
}

function toChangedFileStatus(status: string): ChangedFile["status"] {
  if (
    status === "added" ||
    status === "modified" ||
    status === "removed" ||
    status === "renamed" ||
    status === "copied" ||
    status === "changed" ||
    status === "unchanged"
  ) {
    return status;
  }

  throw new Error(`GitHub returned an unsupported changed-file status: ${status}`);
}

function toGitHubReviewComment(comment: ReviewCommentInput) {
  return {
    body: comment.body,
    line: comment.line,
    path: comment.path,
    side: comment.side,
    ...(comment.startLine === undefined
      ? {}
      : {
          start_line: comment.startLine,
          start_side: comment.startSide ?? comment.side,
        }),
  };
}

function toPublishedReview(data: unknown): PublishedReview {
  if (!isRecord(data)) {
    throw new Error("GitHub review response is not an object.");
  }

  const htmlUrl = readOptionalString(data, "html_url");
  return {
    githubReviewId: readInteger(data, "id"),
    htmlUrl: htmlUrl ?? null,
  };
}

function readReviewList(
  data: unknown,
): Array<{ body: string | null; htmlUrl: string | null; id: number }> {
  if (!Array.isArray(data)) {
    throw new Error("GitHub review-list response is not an array.");
  }
  return data.map((review) => {
    if (!isRecord(review)) {
      throw new Error("GitHub review-list response contains an invalid review.");
    }
    return {
      body: readOptionalString(review, "body") ?? null,
      htmlUrl: readOptionalString(review, "html_url") ?? null,
      id: readInteger(review, "id"),
    };
  });
}

function readResponseData(response: unknown): unknown {
  if (!isRecord(response) || !("data" in response)) {
    throw new Error("GitHub API response does not contain data.");
  }

  return response["data"];
}

function readInteger(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`GitHub API response has invalid numeric field "${key}".`);
  }

  return value;
}

function readOptionalInteger(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`GitHub API response has invalid numeric field "${key}".`);
  }
  return value;
}

function readDate(source: Record<string, unknown>, key: string): Date {
  const value = readOptionalString(source, key);
  if (value === undefined) {
    throw new Error(`GitHub API response is missing string field "${key}".`);
  }
  return toDate(value, key);
}

function readOptionalDate(source: Record<string, unknown>, key: string): Date | null {
  const value = readOptionalString(source, key);
  return value === undefined ? null : toDate(value, key);
}

function toDate(value: string, key: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`GitHub API response has invalid date field "${key}".`);
  }
  return date;
}

function readObject(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  if (!isRecord(value)) {
    throw new Error(`GitHub API response is missing object field "${key}".`);
  }
  return value;
}

function readOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`GitHub API response has invalid string field "${key}".`);
  }

  return value;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = readOptionalString(source, key);
  if (value === undefined || value.length === 0) {
    throw new Error(`GitHub API response is missing string field "${key}".`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
