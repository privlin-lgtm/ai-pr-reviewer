import { redactMessage } from "../observability/structured-logger.js";

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

export interface ClassifiedJobFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export function classifyJobFailure(error: unknown): ClassifiedJobFailure {
  const message = redactMessage(
    error instanceof Error ? error.message : "Unknown worker failure.",
    8_000,
  );
  const status = readNumberProperty(error, "status");
  if (status !== undefined) {
    return {
      code: `HTTP_${status}`,
      message,
      retryable: status === 408 || status === 409 || status === 425 || status === 429 || status >= 500,
    };
  }

  const code = readStringProperty(error, "code");
  if (code !== undefined) {
    return {
      code: code.slice(0, 128),
      message,
      retryable: TRANSIENT_NETWORK_CODES.has(code),
    };
  }

  const name = error instanceof Error ? error.name : "UnknownError";
  const permanent =
    /^(?:Invalid|Validation|Range|Syntax|Type|ChangedFileLimitExceeded|DiffTooLarge|Document)/.test(
      name,
    );
  return {
    code: name.slice(0, 128) || "UNKNOWN",
    message,
    retryable: !permanent,
  };
}

function readStringProperty(error: unknown, key: string): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readNumberProperty(error: unknown, key: string): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
