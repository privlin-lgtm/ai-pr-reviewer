import type {
  AIReviewContextProvider,
  AnalyzeDiffRequest,
  RetrievedStandardSource,
} from "../ai/types.js";
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

  async getStandards(request: AnalyzeDiffRequest): Promise<{
    snippets: string[];
    sources: RetrievedStandardSource[];
  }> {
    if (request.ragContext === undefined) {
      return { snippets: [], sources: [] };
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

    return assembleRetrievedStandardsWithSources(chunks, this.maximumContextCharacters);
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
  return assembleRetrievedStandardsWithSources(chunks, maximumCharacters).snippets;
}

export function assembleRetrievedStandardsWithSources(
  chunks: RetrievedRepositoryChunk[],
  maximumCharacters = DEFAULT_MAXIMUM_CONTEXT_CHARACTERS,
): { snippets: string[]; sources: RetrievedStandardSource[] } {
  const context: string[] = [];
  const sources: RetrievedStandardSource[] = [];
  let usedCharacters = 0;

  for (const chunk of chunks) {
    const block = `[standard:${chunk.path}#${chunk.chunkIndex}@${chunk.contentSha}]\n${chunk.content}`;
    const remaining = maximumCharacters - usedCharacters;
    if (remaining <= 0) {
      break;
    }

    context.push(block.slice(0, remaining));
    sources.push({
      chunkIndex: chunk.chunkIndex,
      contentSha: chunk.contentSha,
      path: chunk.path,
      reference: standardReference(chunk),
      similarity: chunk.similarity,
    });
    usedCharacters += Math.min(block.length, remaining);
  }

  return { snippets: context, sources };
}

export function standardReference(chunk: Pick<RetrievedRepositoryChunk, "chunkIndex" | "contentSha" | "path">): string {
  return `[standard:${chunk.path}#${chunk.chunkIndex}@${chunk.contentSha}]`;
}
