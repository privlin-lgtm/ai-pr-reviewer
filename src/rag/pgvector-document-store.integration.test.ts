import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { PgVectorRepositoryDocumentStore } from "./pgvector-document-store.js";

const enabled = process.env.RUN_PGVECTOR_INTEGRATION === "1";

test(
  "stores provenance and retrieves only repository-scoped pgvector documents",
  { skip: !enabled },
  async () => {
    const connectionString = process.env.DATABASE_URL;
    assert.ok(connectionString, "DATABASE_URL is required for pgvector integration tests.");
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    });
    const suffix = randomUUID();
    let repositoryId: string | undefined;
    try {
      await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector");
      const installation = await prisma.gitHubInstallation.create({
        data: {
          accountLogin: `integration-${suffix}`,
          accountType: "User",
          githubInstallationId: BigInt(`9${Date.now().toString().slice(-12)}`),
        },
      });
      const repository = await prisma.repository.create({
        data: {
          defaultBranch: "main",
          fullName: `integration-${suffix}/repo`,
          githubRepositoryId: BigInt(`8${Date.now().toString().slice(-12)}`),
          installationId: installation.id,
          name: "repo",
          ownerLogin: `integration-${suffix}`,
        },
      });
      repositoryId = repository.id;
      const vector = Array.from({ length: 1_536 }, (_, index) => (index === 0 ? 1 : 0));
      const store = new PgVectorRepositoryDocumentStore(prisma);
      await store.replaceDocument({
        branch: "main",
        chunks: [{ chunkIndex: 0, content: "Always validate webhook signatures.", embedding: vector }],
        contentSha: "integration-sha",
        embeddingDimensions: 1_536,
        embeddingModel: "integration-model",
        path: "docs/security.md",
        provenance: { indexedBy: "integration-test", sourcePath: "docs/security.md" },
        repositoryId,
      });
      const results = await store.search({
        branch: "main",
        embedding: vector,
        embeddingModel: "integration-model",
        limit: 3,
        repositoryId,
      });

      assert.equal(results.length, 1);
      assert.equal(results[0]?.path, "docs/security.md");
      const document = await prisma.repositoryDocument.findFirst({
        select: { metadata: true },
        where: { repositoryId },
      });
      assert.deepEqual(document?.metadata, {
        chunkIndex: 0,
        contentSha: "integration-sha",
        indexedBy: "integration-test",
        sourcePath: "docs/security.md",
      });
    } finally {
      if (repositoryId !== undefined) {
        await prisma.repository.delete({ where: { id: repositoryId } }).catch(() => undefined);
      }
      await prisma.$disconnect();
    }
  },
);
