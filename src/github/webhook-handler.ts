import {
  InvalidWebhookPayloadError,
  InvalidWebhookSignatureError,
} from "./errors.js";
import type {
  GitHubRepositoryRef,
  PullRequestAnalysisEnqueuer,
  PullRequestWebhookEvent,
  WebhookHandlingResult,
  WebhookRequest,
  WebhookSignatureVerifier,
} from "./types.js";

const SUPPORTED_ACTIONS = new Set(["opened", "synchronize"]);

export class PullRequestWebhookHandler {
  constructor(
    private readonly signatureVerifier: WebhookSignatureVerifier,
    private readonly analysisEnqueuer: PullRequestAnalysisEnqueuer,
  ) {}

  async handle(request: WebhookRequest): Promise<WebhookHandlingResult> {
    const isValid = await this.signatureVerifier.verify(request.body, request.signature);
    if (!isValid) {
      throw new InvalidWebhookSignatureError();
    }

    if (request.eventName !== "pull_request") {
      return { status: "ignored", reason: `Unsupported GitHub event: ${request.eventName}` };
    }

    const payload = parsePayload(request.body);
    const action = readString(payload, "action");
    if (!SUPPORTED_ACTIONS.has(action)) {
      return { status: "ignored", reason: `Unsupported pull_request action: ${action}` };
    }

    const event = toPullRequestWebhookEvent(payload, request.deliveryId, action);
    await this.analysisEnqueuer.enqueue(event);

    return { status: "accepted", event };
  }
}

function parsePayload(body: string): Record<string, unknown> {
  try {
    const payload: unknown = JSON.parse(body);
    if (!isRecord(payload)) {
      throw new InvalidWebhookPayloadError("GitHub webhook payload must be a JSON object.");
    }

    return payload;
  } catch (error) {
    if (error instanceof InvalidWebhookPayloadError) {
      throw error;
    }

    throw new InvalidWebhookPayloadError("GitHub webhook payload is not valid JSON.");
  }
}

function toPullRequestWebhookEvent(
  payload: Record<string, unknown>,
  deliveryId: string,
  action: string,
): PullRequestWebhookEvent {
  if (!SUPPORTED_ACTIONS.has(action)) {
    throw new InvalidWebhookPayloadError(`Unsupported pull_request action: ${action}`);
  }

  if (deliveryId.length === 0) {
    throw new InvalidWebhookPayloadError("GitHub webhook delivery ID is required.");
  }

  const repository = readObject(payload, "repository");
  const repositoryOwner = readObject(repository, "owner");
  const pullRequest = readObject(payload, "pull_request");
  const head = readObject(pullRequest, "head");
  const installation = readObject(payload, "installation");

  return {
    action: action as PullRequestWebhookEvent["action"],
    deliveryId,
    installationId: readSafeInteger(installation, "id"),
    repository: toRepositoryReference(repository, repositoryOwner),
    pullRequest: {
      id: readSafeInteger(pullRequest, "id"),
      number: readSafeInteger(payload, "number"),
      headSha: readString(head, "sha"),
    },
  };
}

function toRepositoryReference(
  repository: Record<string, unknown>,
  owner: Record<string, unknown>,
): GitHubRepositoryRef {
  return {
    id: readSafeInteger(repository, "id"),
    owner: readString(owner, "login"),
    name: readString(repository, "name"),
  };
}

function readObject(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  if (!isRecord(value)) {
    throw new InvalidWebhookPayloadError(`GitHub webhook payload is missing object field "${key}".`);
  }

  return value;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidWebhookPayloadError(`GitHub webhook payload is missing string field "${key}".`);
  }

  return value;
}

function readSafeInteger(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new InvalidWebhookPayloadError(`GitHub webhook payload has invalid numeric field "${key}".`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
