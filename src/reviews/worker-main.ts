import OpenAI from "openai";

import { createAIReviewEngine } from "../ai/ai-review-service.js";
import { loadAIReviewConfig } from "../ai/config.js";
import { loadGitHubAppConfig } from "../github/config.js";
import { createGitHubAppServices } from "../github/github-app.js";
import { prisma } from "../lib/prisma.js";
import {
  OpenAIEmbeddingModel,
  OctokitRepositoryStandardsSource,
  PgVectorRepositoryDocumentStore,
  PrismaRepositoryIndexJobStore,
  RagReviewContextProvider,
  RepositoryIndexWorker,
  RepositoryStandardsIndexer,
  RepositoryStandardsIndexJobHandler,
  loadRAGConfig,
} from "../rag/index.js";
import { createStructuredLogger } from "../observability/structured-logger.js";
import { PrismaReviewJobHandler } from "./prisma-review-job-handler.js";
import { PrismaReviewJobStore } from "./prisma-review-job-store.js";
import { PrismaPublicationOutboxStore } from "./prisma-publication-outbox-store.js";
import {
  GitHubReviewOutboxPublisher,
  PublicationOutboxWorker,
} from "./publication-outbox.js";
import { MultiQueueRunner } from "./multi-queue-runner.js";
import { ReviewJobWorker } from "./review-job-worker.js";
import { startWorkerHealthServer, WorkerHealth } from "./worker-health.js";

const workerId =
  process.env.REVIEW_WORKER_ID?.trim() ||
  `${process.env.HOSTNAME ?? "review-worker"}-${process.pid}`;
const idleDelayMilliseconds = parsePositiveInteger(
  process.env.REVIEW_WORKER_POLL_MS,
  1_000,
  "REVIEW_WORKER_POLL_MS",
);
const healthPort = parsePort(process.env.REVIEW_WORKER_HEALTH_PORT, 8_081);
const logger = createStructuredLogger({
  baseFields: { component: "review-worker", workerId },
});

const aiConfig = loadAIReviewConfig();
const ragConfig = loadRAGConfig();
const gitHubServices = createGitHubAppServices(loadGitHubAppConfig());
const contextProvider = new RagReviewContextProvider(
  new OpenAIEmbeddingModel(
    new OpenAI({ apiKey: ragConfig.apiKey }),
    ragConfig.embeddingModel,
    ragConfig.embeddingDimensions,
  ),
  new PgVectorRepositoryDocumentStore(prisma),
  {
    embeddingModel: ragConfig.embeddingModel,
    retrievalLimit: ragConfig.retrievalLimit,
  },
);
const reviewWorker = new ReviewJobWorker(
  new PrismaReviewJobStore(prisma),
  new PrismaReviewJobHandler(
    prisma,
    gitHubServices.pullRequests,
    createAIReviewEngine(aiConfig, { contextProvider }),
    { modelName: aiConfig.model },
  ),
  workerId,
);
const publicationWorker = new PublicationOutboxWorker(
  new PrismaPublicationOutboxStore(prisma),
  new GitHubReviewOutboxPublisher(gitHubServices.pullRequests),
  workerId,
);
const indexWorker = new RepositoryIndexWorker(
  new PrismaRepositoryIndexJobStore(prisma, {
    embeddingModel: ragConfig.embeddingModel,
  }),
  new RepositoryStandardsIndexJobHandler(
    new RepositoryStandardsIndexer(
      new OctokitRepositoryStandardsSource(gitHubServices.app),
      new OpenAIEmbeddingModel(
        new OpenAI({ apiKey: ragConfig.apiKey }),
        ragConfig.embeddingModel,
        ragConfig.embeddingDimensions,
      ),
      new PgVectorRepositoryDocumentStore(prisma),
      {
        embeddingDimensions: ragConfig.embeddingDimensions,
        embeddingModel: ragConfig.embeddingModel,
      },
    ),
  ),
  workerId,
);
const health = new WorkerHealth({
  probe: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
});
const runner = new MultiQueueRunner(
  [reviewWorker, publicationWorker, indexWorker],
  {
    idleDelayMilliseconds,
    logger,
    onError: () => health.recordError(),
    onIteration: () => health.recordIteration(),
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    runner.stop();
  });
}

let healthServer: Awaited<ReturnType<typeof startWorkerHealthServer>> | undefined;
try {
  healthServer = await startWorkerHealthServer(health, { logger, port: healthPort });
  await runner.run();
} finally {
  await healthServer?.close();
  await prisma.$disconnect();
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

function parsePort(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim().length === 0) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("REVIEW_WORKER_HEALTH_PORT must be a TCP port between 1 and 65535.");
  }
  return parsed;
}
