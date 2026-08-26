export interface RetryOptions {
  baseDelayMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
  maxDelayMs?: number;
}

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

export async function retryTransient<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 4_000;
  const delay = options.delay ?? sleep;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer.");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts || !isTransientGitHubFailure(error)) {
        throw error;
      }

      const retryAfterMs = getRetryAfterMilliseconds(error);
      const backoffMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await delay(retryAfterMs ?? backoffMs);
    }
  }

  throw new Error("Retry attempts were exhausted.");
}

export function isTransientGitHubFailure(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  const status = error["status"];
  if (typeof status === "number") {
    return status === 408 || status === 429 || status >= 500;
  }

  const code = error["code"];
  return typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code);
}

function getRetryAfterMilliseconds(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error["response"]) || !isRecord(error["response"]["headers"])) {
    return undefined;
  }

  const retryAfter = error["response"]["headers"]["retry-after"];
  if (typeof retryAfter !== "string" && typeof retryAfter !== "number") {
    return undefined;
  }

  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
