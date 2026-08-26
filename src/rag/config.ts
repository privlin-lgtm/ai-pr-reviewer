export interface RAGConfig {
  apiKey: string;
  embeddingDimensions: number;
  embeddingModel: string;
  retrievalLimit: number;
}

const DEFAULT_EMBEDDING_DIMENSIONS = 1_536;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_RETRIEVAL_LIMIT = 6;

export function loadRAGConfig(environment: NodeJS.ProcessEnv = process.env): RAGConfig {
  const apiKey = environment.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const retrievalLimit = parsePositiveInteger(
    environment.RAG_RETRIEVAL_LIMIT,
    DEFAULT_RETRIEVAL_LIMIT,
    "RAG_RETRIEVAL_LIMIT",
  );

  return {
    apiKey,
    embeddingDimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    embeddingModel:
      environment.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL,
    retrievalLimit,
  };
}

function parsePositiveInteger(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number {
  if (value === undefined || value.trim().length === 0) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}
