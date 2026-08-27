import type {
  PullRequestAnalysisEnqueuer,
  PullRequestWebhookEvent,
  WebhookSignatureVerifier,
} from "./types";
import type { WebhookRateLimiter } from "./webhook-rate-limiter";

export interface GitHubWebhookRouteDependencies {
  maximumBodyBytes: number;
  rateLimiter: WebhookRateLimiter;
  signatureVerifier: WebhookSignatureVerifier;
  queue: PullRequestAnalysisEnqueuer;
}

export class RequestBodyTooLargeError extends Error {
  constructor(maximumBodyBytes: number) {
    super(`Webhook body exceeds ${maximumBodyBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

class WebhookRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Webhook delivery is rate limited.");
    this.name = "WebhookRateLimitedError";
  }
}

class InvalidWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWebhookPayloadError";
  }
}

class InvalidWebhookSignatureError extends Error {
  constructor() {
    super("GitHub webhook signature is invalid.");
    this.name = "InvalidWebhookSignatureError";
  }
}

export async function handleGitHubWebhookRequest(
  request: Request,
  dependencies: GitHubWebhookRouteDependencies,
): Promise<Response> {
  try {
    validateMaximumBodyBytes(dependencies.maximumBodyBytes);
    const body = await readRawUtf8Body(request, dependencies.maximumBodyBytes);
    const signature = request.headers.get("x-hub-signature-256") ?? undefined;
    if (
      signature === undefined ||
      !(await dependencies.signatureVerifier.verify(body, signature))
    ) {
      throw new InvalidWebhookSignatureError();
    }
    if (request.headers.get("x-github-event") !== "pull_request") {
      return noStoreResponse(null, 204);
    }
    const event = parsePullRequestEvent(
      body,
      request.headers.get("x-github-delivery") ?? "",
    );
    if (event === null) {
      return noStoreResponse(null, 204);
    }
    const decision = await dependencies.rateLimiter.consume(
      `installation:${event.installationId}`,
    );
    if (!decision.allowed) {
      throw new WebhookRateLimitedError(decision.retryAfterSeconds);
    }
    await dependencies.queue.enqueue(event);
    return jsonNoStore({ status: "accepted" }, 202);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonNoStore({ error: "Webhook body is too large." }, 413);
    }
    if (error instanceof InvalidWebhookSignatureError) {
      return jsonNoStore({ error: "Invalid GitHub webhook signature." }, 401);
    }
    if (error instanceof InvalidWebhookPayloadError) {
      return jsonNoStore({ error: "Invalid GitHub webhook payload." }, 400);
    }
    if (error instanceof WebhookRateLimitedError) {
      return jsonNoStore(
        { error: "Webhook delivery is rate limited." },
        429,
        { "retry-after": String(error.retryAfterSeconds) },
      );
    }
    return jsonNoStore(
      { error: "Webhook delivery could not be persisted. GitHub may retry it." },
      503,
    );
  }
}

export async function readRawUtf8Body(
  request: Request,
  maximumBodyBytes: number,
): Promise<string> {
  validateMaximumBodyBytes(maximumBodyBytes);
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > maximumBodyBytes) {
      throw new RequestBodyTooLargeError(maximumBodyBytes);
    }
  }

  if (request.body === null) {
    return "";
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      byteLength += next.value.byteLength;
      if (byteLength > maximumBodyBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(maximumBodyBytes);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new InvalidWebhookPayloadError("GitHub webhook body is not valid UTF-8.");
  }
}

function validateMaximumBodyBytes(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError("maximumBodyBytes must be a positive integer.");
  }
}

function jsonNoStore(
  body: Record<string, string>,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    headers: { "cache-control": "no-store", ...headers },
    status,
  });
}

function noStoreResponse(body: BodyInit | null, status: number): Response {
  return new Response(body, { headers: { "cache-control": "no-store" }, status });
}

function parsePullRequestEvent(
  body: string,
  deliveryId: string,
): PullRequestWebhookEvent | null {
  const payload = parsePayload(body);
  const action = readString(payload, "action");
  if (action !== "opened" && action !== "synchronize") {
    return null;
  }
  if (deliveryId.length === 0) {
    throw new InvalidWebhookPayloadError("GitHub webhook delivery ID is required.");
  }
  const repository = readObject(payload, "repository");
  const owner = readObject(repository, "owner");
  const pullRequest = readObject(payload, "pull_request");
  const head = readObject(pullRequest, "head");
  const installation = readObject(payload, "installation");
  return {
    action,
    deliveryId,
    installationId: readSafeInteger(installation, "id"),
    pullRequest: {
      headSha: readString(head, "sha"),
      id: readSafeInteger(pullRequest, "id"),
      number: readSafeInteger(payload, "number"),
    },
    repository: {
      id: readSafeInteger(repository, "id"),
      name: readString(repository, "name"),
      owner: readString(owner, "login"),
    },
  };
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
