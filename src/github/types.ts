export interface GitHubRepositoryRef {
  id: number;
  owner: string;
  name: string;
}

export interface PullRequestWebhookEvent {
  action: "opened" | "synchronize";
  deliveryId: string;
  installationId: number;
  repository: GitHubRepositoryRef;
  pullRequest: {
    id: number;
    number: number;
    headSha: string;
  };
}

export interface WebhookRequest {
  body: string;
  deliveryId: string;
  eventName: string;
  signature?: string;
}

export type WebhookHandlingResult =
  | { status: "accepted"; event: PullRequestWebhookEvent }
  | { status: "ignored"; reason: string };

export interface WebhookSignatureVerifier {
  verify(body: string, signature: string | undefined): Promise<boolean>;
}

export interface PullRequestAnalysisEnqueuer {
  enqueue(event: PullRequestWebhookEvent): Promise<void>;
}

export interface PullRequestTarget {
  installationId: number;
  owner: string;
  repository: string;
  pullNumber: number;
}

export interface PullRequestDiff extends PullRequestTarget {
  content: string;
}

export interface PullRequestMetadata extends PullRequestTarget {
  authorGithubLogin: string;
  authorGithubUserId: number | null;
  baseRef: string;
  baseSha: string;
  body: string | null;
  closedAt: Date | null;
  createdAt: Date;
  githubPullRequestId: number;
  headRef: string;
  headSha: string;
  isDraft: boolean;
  mergedAt: Date | null;
  state: "OPEN" | "CLOSED" | "MERGED";
  title: string;
  updatedAt: Date;
}

export interface ChangedFile {
  additions: number;
  deletions: number;
  patch: string | null;
  path: string;
  previousPath: string | null;
  status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";
}

export interface ReviewCommentInput {
  body: string;
  line: number;
  path: string;
  side: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
}

export interface ReviewSubmission extends PullRequestTarget {
  body: string;
  commitSha: string;
  comments: ReviewCommentInput[];
  event: "COMMENT" | "REQUEST_CHANGES";
}

export interface PublishedReview {
  githubReviewId: number;
  htmlUrl: string | null;
}

export interface GitHubPullRequestService {
  fetchDiff(target: PullRequestTarget): Promise<PullRequestDiff>;
  fetchMetadata(target: PullRequestTarget): Promise<PullRequestMetadata>;
  listChangedFiles(target: PullRequestTarget, maximumFiles?: number): Promise<ChangedFile[]>;
  publishReview(submission: ReviewSubmission): Promise<PublishedReview>;
}
