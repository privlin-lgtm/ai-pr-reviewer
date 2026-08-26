import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { InvalidVectorError } from "./errors.js";
import type {
  EmbeddedRepositoryDocument,
  RepositoryDocumentSearch,
  RepositoryDocumentStore,
  RetrievedRepositoryChunk,
} from "./types.js";

export const PGVECTOR_RETRIEVAL_QUERY_DESCRIPTION =
  'Repository-scoped cosine search filters "repositoryId", "branch", and "embeddingModel" before ordering by "embedding" <=> query vector.';

export class PgVectorRepositoryDocumentStore implements RepositoryDocumentStore {
  constructor(private readonly prisma: PrismaClient) {}

  async replaceDocument(document: EmbeddedRepositoryDocument): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      for (const chunk of document.chunks) {
        const vector = toVectorLiteral(chunk.embedding, document.embeddingDimensions);
        await transaction.$executeRaw`
          INSERT INTO "RepositoryDocument" (
            "id", "repositoryId", "path", "branch", "contentSha", "chunkIndex",
            "content", "embeddingModel", "embeddingDimensions", "embedding",
            "createdAt", "updatedAt"
          ) VALUES (
            ${randomUUID()}, ${document.repositoryId}, ${document.path},
            ${document.branch}, ${document.contentSha}, ${chunk.chunkIndex},
            ${chunk.content}, ${document.embeddingModel}, ${document.embeddingDimensions},
            ${vector}::vector, NOW(), NOW()
          )
          ON CONFLICT ("repositoryId", "path", "branch", "contentSha", "chunkIndex")
          DO UPDATE SET
            "content" = EXCLUDED."content",
            "embeddingModel" = EXCLUDED."embeddingModel",
            "embeddingDimensions" = EXCLUDED."embeddingDimensions",
            "embedding" = EXCLUDED."embedding",
            "updatedAt" = NOW()
        `;
      }

      await transaction.$executeRaw`
        DELETE FROM "RepositoryDocument"
        WHERE "repositoryId" = ${document.repositoryId}
          AND "path" = ${document.path}
          AND "branch" = ${document.branch}
          AND "contentSha" <> ${document.contentSha}
      `;
    });
  }

  async completeSnapshot(scope: {
    branch: string;
    paths: string[];
    repositoryId: string;
  }): Promise<void> {
    if (scope.paths.length === 0) {
      await this.prisma.$executeRaw`
        DELETE FROM "RepositoryDocument"
        WHERE "repositoryId" = ${scope.repositoryId}
          AND "branch" = ${scope.branch}
      `;
      return;
    }

    await this.prisma.$executeRaw`
      DELETE FROM "RepositoryDocument"
      WHERE "repositoryId" = ${scope.repositoryId}
        AND "branch" = ${scope.branch}
        AND "path" NOT IN (${Prisma.join(scope.paths)})
    `;
  }

  async search(query: RepositoryDocumentSearch): Promise<RetrievedRepositoryChunk[]> {
    const vector = toVectorLiteral(query.embedding);
    const rows = await this.prisma.$queryRaw<RetrievedRepositoryChunk[]>`
      SELECT
        "chunkIndex" AS "chunkIndex",
        "content" AS "content",
        "contentSha" AS "contentSha",
        "path" AS "path",
        1 - ("embedding" <=> ${vector}::vector) AS "similarity"
      FROM "RepositoryDocument"
      WHERE "repositoryId" = ${query.repositoryId}
        AND "branch" = ${query.branch}
        AND "embeddingModel" = ${query.embeddingModel}
      ORDER BY "embedding" <=> ${vector}::vector
      LIMIT ${query.limit}
    `;

    return rows;
  }
}

export function toVectorLiteral(vector: number[], expectedDimensions?: number): string {
  if (vector.length === 0) {
    throw new InvalidVectorError("Vector must not be empty.");
  }

  if (expectedDimensions !== undefined && vector.length !== expectedDimensions) {
    throw new InvalidVectorError(
      `Expected ${expectedDimensions} embedding dimensions but received ${vector.length}.`,
    );
  }

  if (vector.some((value) => !Number.isFinite(value))) {
    throw new InvalidVectorError("Vector values must be finite numbers.");
  }

  return `[${vector.join(",")}]`;
}
