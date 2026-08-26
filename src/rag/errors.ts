export class RagError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RagError";
  }
}

export class DocumentExtractionError extends RagError {
  constructor(path: string, message: string) {
    super(`Cannot extract "${path}": ${message}`);
    this.name = "DocumentExtractionError";
  }
}

export class EmbeddingResponseError extends RagError {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingResponseError";
  }
}

export class InvalidVectorError extends RagError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVectorError";
  }
}

export class RepositoryTreeTruncatedError extends RagError {
  constructor() {
    super("GitHub returned a truncated repository tree; refusing to index a partial standards snapshot.");
    this.name = "RepositoryTreeTruncatedError";
  }
}

export class RepositoryDocumentLimitError extends RagError {
  constructor(limit: number) {
    super(`Repository standards exceed the configured ${limit}-document limit.`);
    this.name = "RepositoryDocumentLimitError";
  }
}

export class RepositoryDocumentSizeLimitError extends RagError {
  constructor(path: string, limit: number) {
    super(`Repository standards document "${path}" exceeds the configured ${limit}-byte limit.`);
    this.name = "RepositoryDocumentSizeLimitError";
  }
}
