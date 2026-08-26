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
