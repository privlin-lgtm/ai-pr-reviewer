import type {
  GitHubPullRequestService,
  PublishedReview,
  PullRequestTarget,
  ReviewCommentInput,
  ReviewSubmission,
} from "../github/types.js";
import {
  createStructuredLogger,
  errorLogFields,
  type StructuredLogger,
} from "../observability/structured-logger.js";
import { classifyJobFailure, type ClassifiedJobFailure } from "./job-failure.js";

export interface ReviewPublicationPayload {
  body: string;
  comments: ReviewCommentInput[];
  commitSha: string;
  event: ReviewSubmission["event"];
  marker: string;
  target: PullRequestTarget;
  version: 1;
}

export interface ClaimedPublicationOutbox {
  attempts: number;
  id: string;
  idempotencyKey: string;
  payload: unknown;
  reviewId: string;
}

export interface PublicationOutboxStore {
  claimNext(workerId: string): Promise<ClaimedPublicationOutbox | null>;
  complete(
    outbox: ClaimedPublicationOutbox,
    workerId: string,
    published: PublishedReview,
  ): Promise<boolean>;
  fail(
    outboxId: string,
    workerId: string,
    attempt: number,
    failure: ClassifiedJobFailure,
  ): Promise<boolean>;
  heartbeat(outboxId: string, workerId: string): Promise<boolean>;
}

export interface PublicationOutboxPublisher {
  publish(outbox: ClaimedPublicationOutbox): Promise<PublishedReview>;
}

export class GitHubReviewOutboxPublisher implements PublicationOutboxPublisher {
  constructor(private readonly pullRequests: GitHubPullRequestService) {}

  async publish(outbox: ClaimedPublicationOutbox): Promise<PublishedReview> {
    const payload = parseReviewPublicationPayload(outbox.payload);
    const existing = await this.pullRequests.findPublishedReviewByMarker(
      payload.target,
      payload.marker,
    );
    if (existing !== null) {
      return existing;
    }

    return this.pullRequests.publishReview({
      ...payload.target,
      body: appendMarker(payload.body, payload.marker),
      comments: payload.comments,
      commitSha: payload.commitSha,
      event: payload.event,
    });
  }
}

export interface PublicationOutboxWorkerOptions {
  heartbeatIntervalMilliseconds?: number;
  logger?: StructuredLogger;
}

export class PublicationOutboxWorker {
  private readonly heartbeatIntervalMilliseconds: number;
  private readonly logger: StructuredLogger;

  constructor(
    private readonly store: PublicationOutboxStore,
    private readonly publisher: PublicationOutboxPublisher,
    private readonly workerId: string,
    options: PublicationOutboxWorkerOptions = {},
  ) {
    this.heartbeatIntervalMilliseconds =
      options.heartbeatIntervalMilliseconds ?? 15_000;
    if (
      !Number.isInteger(this.heartbeatIntervalMilliseconds) ||
      this.heartbeatIntervalMilliseconds < 1
    ) {
      throw new RangeError("heartbeatIntervalMilliseconds must be a positive integer.");
    }
    this.logger =
      options.logger ??
      createStructuredLogger({ baseFields: { component: "publication-outbox-worker", workerId } });
  }

  async runOnce(): Promise<boolean> {
    const outbox = await this.store.claimNext(this.workerId);
    if (outbox === null) {
      return false;
    }

    let leaseLost = false;
    let heartbeatRunning = false;
    const heartbeat = async () => {
      if (heartbeatRunning || leaseLost) {
        return;
      }
      heartbeatRunning = true;
      try {
        if (!(await this.store.heartbeat(outbox.id, this.workerId))) {
          leaseLost = true;
          this.logger.warn("publication_outbox_lease_lost", { outboxId: outbox.id });
        }
      } catch (error) {
        this.logger.warn("publication_outbox_heartbeat_failed", {
          outboxId: outbox.id,
          ...errorLogFields(error),
        });
      } finally {
        heartbeatRunning = false;
      }
    };
    const timer = setInterval(() => {
      void heartbeat();
    }, this.heartbeatIntervalMilliseconds);
    timer.unref?.();

    try {
      const published = await this.publisher.publish(outbox);
      await heartbeat();
      if (!leaseLost) {
        const completed = await this.store.complete(outbox, this.workerId, published);
        if (!completed) {
          this.logger.warn("publication_outbox_transition_lost_lease", {
            outboxId: outbox.id,
            transition: "complete",
          });
        }
      }
    } catch (error) {
      if (!leaseLost) {
        const failure = classifyJobFailure(error);
        const transitioned = await this.store.fail(
          outbox.id,
          this.workerId,
          outbox.attempts,
          failure,
        );
        this.logger.warn("publication_outbox_failed", {
          outboxId: outbox.id,
          failureCode: failure.code,
          retryable: failure.retryable,
          transitioned,
        });
      }
    } finally {
      clearInterval(timer);
    }

    return true;
  }
}

export function publicationMarker(idempotencyKey: string): string {
  return `<!-- ai-pr-reviewer-publication:${idempotencyKey} -->`;
}

export function appendMarker(body: string, marker: string): string {
  return body.includes(marker) ? body : `${body.trimEnd()}\n\n${marker}`;
}

export function parseReviewPublicationPayload(value: unknown): ReviewPublicationPayload {
  if (!isRecord(value)) {
    throw new InvalidPublicationPayloadError("Publication payload must be an object.");
  }
  if (
    value["version"] !== 1 ||
    typeof value["body"] !== "string" ||
    typeof value["commitSha"] !== "string" ||
    typeof value["marker"] !== "string" ||
    !isRecord(value["target"]) ||
    !Array.isArray(value["comments"]) ||
    (value["event"] !== "COMMENT" && value["event"] !== "REQUEST_CHANGES")
  ) {
    throw new InvalidPublicationPayloadError("Publication payload has an invalid shape.");
  }

  const target = value["target"];
  if (
    typeof target["installationId"] !== "number" ||
    !Number.isSafeInteger(target["installationId"]) ||
    typeof target["owner"] !== "string" ||
    typeof target["repository"] !== "string" ||
    typeof target["pullNumber"] !== "number" ||
    !Number.isSafeInteger(target["pullNumber"])
  ) {
    throw new InvalidPublicationPayloadError("Publication target is invalid.");
  }

  const comments = value["comments"].map((comment) => parseReviewComment(comment));
  return {
    body: value["body"],
    comments,
    commitSha: value["commitSha"],
    event: value["event"],
    marker: value["marker"],
    target: {
      installationId: target["installationId"],
      owner: target["owner"],
      pullNumber: target["pullNumber"],
      repository: target["repository"],
    },
    version: 1,
  };
}

export class InvalidPublicationPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPublicationPayloadError";
  }
}

function parseReviewComment(value: unknown): ReviewCommentInput {
  if (
    !isRecord(value) ||
    typeof value["body"] !== "string" ||
    typeof value["line"] !== "number" ||
    !Number.isSafeInteger(value["line"]) ||
    typeof value["path"] !== "string" ||
    (value["side"] !== "LEFT" && value["side"] !== "RIGHT")
  ) {
    throw new InvalidPublicationPayloadError("Publication comment is invalid.");
  }
  if (
    value["startLine"] !== undefined &&
    (typeof value["startLine"] !== "number" || !Number.isSafeInteger(value["startLine"]))
  ) {
    throw new InvalidPublicationPayloadError("Publication comment start line is invalid.");
  }
  if (
    value["startSide"] !== undefined &&
    value["startSide"] !== "LEFT" &&
    value["startSide"] !== "RIGHT"
  ) {
    throw new InvalidPublicationPayloadError("Publication comment start side is invalid.");
  }

  return {
    body: value["body"],
    line: value["line"],
    path: value["path"],
    side: value["side"],
    ...(value["startLine"] === undefined ? {} : { startLine: value["startLine"] }),
    ...(value["startSide"] === undefined ? {} : { startSide: value["startSide"] }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
