export class AIReviewEngineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AIReviewEngineError";
  }
}

export class DiffTooLargeError extends AIReviewEngineError {
  constructor(maximumCharacters: number) {
    super(`Diff exceeds the configured ${maximumCharacters} character limit.`);
    this.name = "DiffTooLargeError";
  }
}

export class InvalidAIReviewInputError extends AIReviewEngineError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAIReviewInputError";
  }
}

export class AIReviewContextError extends AIReviewEngineError {
  constructor(options?: ErrorOptions) {
    super("Repository context retrieval failed.", options);
    this.name = "AIReviewContextError";
  }
}

export class InvalidAIReviewResponseError extends AIReviewEngineError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidAIReviewResponseError";
  }
}

export class OpenAIReviewRequestError extends AIReviewEngineError {
  constructor(options?: ErrorOptions) {
    super("OpenAI review request failed after bounded retries.", options);
    this.name = "OpenAIReviewRequestError";
  }
}
