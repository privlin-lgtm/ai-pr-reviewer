import type { AnalyzeDiffRequest } from "../ai/types.js";

export interface RepositoryDocumentSource {
  content: string;
  path: string;
  sha: string;
}

export interface RepositoryDocumentChunk {
  chunkIndex: number;
  content: string;
}

export interface EmbeddedRepositoryDocument {
  branch: string;
  chunks: Array<RepositoryDocumentChunk & { embedding: number[] }>;
  contentSha: string;
  embeddingDimensions: number;
  embeddingModel: string;
  path: string;
  provenance?: Record<string, boolean | number | string>;
  repositoryId: string;
}

export interface RetrievedRepositoryChunk {
  chunkIndex: number;
  content: string;
  contentSha: string;
  path: string;
  similarity: number;
}

export interface RepositoryDocumentSearch {
  branch: string;
  embedding: number[];
  embeddingModel: string;
  limit: number;
  repositoryId: string;
}

export interface RepositoryDocumentStore {
  completeSnapshot(scope: {
    branch: string;
    paths: string[];
    repositoryId: string;
  }): Promise<void>;
  replaceDocument(document: EmbeddedRepositoryDocument): Promise<void>;
  search(query: RepositoryDocumentSearch): Promise<RetrievedRepositoryChunk[]>;
}

export interface EmbeddingModel {
  embed(inputs: string[]): Promise<number[][]>;
}

export interface RepositoryStandardsTarget {
  branch: string;
  installationId: number;
  owner: string;
  repository: string;
  repositoryId: string;
}

export interface RepositoryStandardsSource {
  listDocuments(target: RepositoryStandardsTarget): Promise<RepositoryDocumentSource[]>;
}

export interface RAGReviewContextProvider {
  getStandards(request: AnalyzeDiffRequest): Promise<string[]>;
}
