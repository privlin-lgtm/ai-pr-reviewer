const SENSITIVE_FIELD = /authorization|cookie|password|private.?key|secret|token|api.?key/i;
const SENSITIVE_VALUE_PATTERNS = [
  /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/gi,
  /\bBearer\s+[^\s,;]+/gi,
  /\bpostgres(?:ql)?:\/\/[^\s,;]+/gi,
  /\b(?:password|token|secret|api[_-]?key|private[_-]?key)\s*([=:])\s*[^\s,;]+/gi,
];

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
}

export interface StructuredLoggerOptions {
  baseFields?: Record<string, unknown>;
  write?: (entry: Record<string, unknown>) => void;
}

export function createStructuredLogger(
  options: StructuredLoggerOptions = {},
): StructuredLogger {
  const write = options.write ?? ((entry) => console.log(JSON.stringify(entry)));
  const emit = (level: LogLevel, event: string, fields?: Record<string, unknown>) => {
    write({
      ...(redactLogValue(options.baseFields ?? {}) as Record<string, unknown>),
      ...(redactLogValue(fields ?? {}) as Record<string, unknown>),
      event,
      level,
      timestamp: new Date().toISOString(),
    });
  };

  return {
    debug: (event, fields) => emit("debug", event, fields),
    error: (event, fields) => emit("error", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
  };
}

export function errorLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorCode: readStringProperty(error, "code"),
      errorName: error.name,
      errorStatus: readNumberProperty(error, "status"),
      errorMessage: redactMessage(error.message),
    };
  }

  return {
    errorMessage: "A non-Error value was thrown.",
    errorName: typeof error,
  };
}

export function redactMessage(value: string, maximumLength = 2_000): string {
  let redacted = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      const separator = match.includes("=") ? "=" : match.includes(":") ? ":" : "";
      return separator.length === 0 ? "[REDACTED]" : `${match.slice(0, match.indexOf(separator) + 1)}[REDACTED]`;
    });
  }
  return redacted.slice(0, maximumLength);
}

export function redactLogValue(value: unknown, key?: string, depth = 0): unknown {
  if (key !== undefined && SENSITIVE_FIELD.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return redactMessage(value);
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (value instanceof Error) {
    return errorLogFields(value);
  }
  if (depth >= 5) {
    return "[TRUNCATED]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactLogValue(item, undefined, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).slice(0, 100).map(([entryKey, entryValue]) => [
        entryKey,
        redactLogValue(entryValue, entryKey, depth + 1),
      ]),
    );
  }
  return String(value);
}

function readStringProperty(error: Error, key: string): string | undefined {
  const value = (error as Error & Record<string, unknown>)[key];
  return typeof value === "string" ? redactMessage(value, 128) : undefined;
}

function readNumberProperty(error: Error, key: string): number | undefined {
  const value = (error as Error & Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
