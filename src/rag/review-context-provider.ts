import type { AIReviewContextProvider, AnalyzeDiffRequest } from "../ai/types.js";
import { retryTransient, type RetryOptions } from "../github/retry.js";

import type {
  EmbeddingModel,
  RepositoryDocumentStore,
  RetrievedRepositoryChunk,
} from "./types.js";

const DEFAULT_MAXIMUM_CONTEXT_CHARACTERS = 6_000;
const DEFAULT_MAXIMUM_QUERY_CHARACTERS = 12_000;

export interface ReviewContextProviderOptions {
  embeddingModel: string;
  maximumContextCharacters?: number;
  maximumQueryCharacters?: number;
  retrievalLimit: number;
  retryOptions?: RetryOptions;
}

export class RagReviewContextProvider implements AIReviewContextProvider {
  private readonly maximumContextCharacters: number;
  private readonly maximumQueryCharacters: number;

  constructor(
    private readonly embeddingModel: EmbeddingModel,
    private readonly documentStore: RepositoryDocumentStore,
    private readonly options: ReviewContextProviderOptions,
  ) {
    this.maximumContextCharacters =
      options.maximumContextCharacters ?? DEFAULT_MAXIMUM_CONTEXT_CHARACTERS;
    this.maximumQueryCharacters =
      options.maximumQueryCharacters ?? DEFAULT_MAXIMUM_QUERY_CHARACTERS;
  }

  async getStandards(request: AnalyzeDiffRequest): Promise<string[]> {
    if (request.ragContext === undefined) {
      return [];
    }

    const [embedding] = await retryTransient(
      () => this.embeddingModel.embed([buildRetrievalQuery(request, this.maximumQueryCharacters)]),
      this.options.retryOptions,
    );
    if (embedding === undefined) {
      throw new Error("Embedding provider returned no query embedding.");
    }

    const chunks = await this.documentStore.search({
      branch: request.ragContext.branch,
      embedding,
      embeddingModel: this.options.embeddingModel,
      limit: this.options.retrievalLimit,
      repositoryId: request.ragContext.repositoryId,
    });

    return assembleRetrievedStandards(chunks, this.maximumContextCharacters);
  }
}

export function buildRetrievalQuery(
  request: AnalyzeDiffRequest,
  maximumCharacters = DEFAULT_MAXIMUM_QUERY_CHARACTERS,
): string {
  return [
    `Repository: ${request.pullRequest.repository}`,
    `Pull request: #${request.pullRequest.number}`,
    request.diff.slice(0, maximumCharacters),
  ].join("\n");
}

export function assembleRetrievedStandards(
  chunks: RetrievedRepositoryChunk[],
  maximumCharacters = DEFAULT_MAXIMUM_CONTEXT_CHARACTERS,
): string[] {
  const context: string[] = [];
  let usedCharacters = 0;

  for (const chunk of chunks) {
    const block = `[standard:${chunk.path}#${chunk.chunkIndex}@${chunk.contentSha}]\n${chunk.content}`;
    const remaining = maximumCharacters - usedCharacters;
    if (remaining <= 0) {
      break;
    }

    context.push(block.slice(0, remaining));
    usedCharacters += Math.min(block.length, remaining);
  }

  return context;
}
