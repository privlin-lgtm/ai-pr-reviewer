import { retryTransient, type RetryOptions } from "../github/retry.js";

import { chunkDocument, type ChunkingOptions } from "./chunker.js";
import { extractIndexableDocuments } from "./document-extractor.js";
import { EmbeddingResponseError } from "./errors.js";
import type {
  EmbeddedRepositoryDocument,
  EmbeddingModel,
  RepositoryDocumentChunk,
  RepositoryDocumentStore,
  RepositoryStandardsSource,
  RepositoryStandardsTarget,
} from "./types.js";

export interface RepositoryStandardsIndexerOptions {
  chunking?: ChunkingOptions;
  embeddingDimensions: number;
  embeddingModel: string;
  embeddingBatchSize?: number;
  retryOptions?: RetryOptions;
}

export interface RepositoryIndexingResult {
  indexedChunks: number;
  indexedDocuments: number;
}

export class RepositoryStandardsIndexer {
  constructor(
    private readonly source: RepositoryStandardsSource,
    private readonly embeddingModel: EmbeddingModel,
    private readonly documentStore: RepositoryDocumentStore,
    private readonly options: RepositoryStandardsIndexerOptions,
  ) {}

  async index(target: RepositoryStandardsTarget): Promise<RepositoryIndexingResult> {
    const documents = extractIndexableDocuments(await this.source.listDocuments(target));
    let indexedChunks = 0;

    for (const document of documents) {
      const chunks = chunkDocument(document.content, this.options.chunking);
      const embeddings = await this.embedChunks(chunks);
      const embeddedDocument: EmbeddedRepositoryDocument = {
        branch: target.branch,
        chunks: chunks.map((chunk, index) => ({
          ...chunk,
          embedding: embeddings[index]!,
        })),
        contentSha: document.sha,
        embeddingDimensions: this.options.embeddingDimensions,
        embeddingModel: this.options.embeddingModel,
        path: document.path,
        repositoryId: target.repositoryId,
      };

      await this.documentStore.replaceDocument(embeddedDocument);
      indexedChunks += chunks.length;
    }

    return {
      indexedChunks,
      indexedDocuments: documents.length,
    };
  }

  private async embedChunks(chunks: RepositoryDocumentChunk[]): Promise<number[][]> {
    const batchSize = this.options.embeddingBatchSize ?? 64;
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError("embeddingBatchSize must be a positive integer.");
    }

    const embeddings: number[][] = [];
    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = chunks.slice(start, start + batchSize);
      const batchEmbeddings = await retryTransient(
        () => this.embeddingModel.embed(batch.map((chunk) => chunk.content)),
        this.options.retryOptions,
      );

      if (batchEmbeddings.length !== batch.length) {
        throw new EmbeddingResponseError("Embedding provider returned an unexpected batch size.");
      }

      if (
        batchEmbeddings.some(
          (embedding) => embedding.length !== this.options.embeddingDimensions,
        )
      ) {
        throw new EmbeddingResponseError(
          `Embedding provider must return ${this.options.embeddingDimensions} dimensions.`,
        );
      }

      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }
}
