import OpenAI from "openai";

import { createAIReviewEngine } from "../ai/ai-review-service.js";
import { loadAIReviewConfig } from "../ai/config.js";
import { loadGitHubAppConfig } from "../github/config.js";
import { createGitHubAppServices } from "../github/github-app.js";
import { prisma } from "../lib/prisma.js";
import {
  OpenAIEmbeddingModel,
  PgVectorRepositoryDocumentStore,
  RagReviewContextProvider,
  loadRAGConfig,
} from "../rag/index.js";
import { PrismaReviewJobHandler } from "./prisma-review-job-handler.js";
import { PrismaReviewJobStore } from "./prisma-review-job-store.js";
import { ReviewJobRunner } from "./review-job-runner.js";
import { ReviewJobWorker } from "./review-job-worker.js";

const workerId =
  process.env.REVIEW_WORKER_ID?.trim() ||
  `${process.env.HOSTNAME ?? "review-worker"}-${process.pid}`;
const idleDelayMilliseconds = parsePositiveInteger(
  process.env.REVIEW_WORKER_POLL_MS,
  1_000,
  "REVIEW_WORKER_POLL_MS",
);

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
const worker = new ReviewJobWorker(
  new PrismaReviewJobStore(prisma),
  new PrismaReviewJobHandler(
    prisma,
    gitHubServices.pullRequests,
    createAIReviewEngine(aiConfig, { contextProvider }),
    { modelName: aiConfig.model },
  ),
  workerId,
);
const runner = new ReviewJobRunner(worker, { idleDelayMilliseconds });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    runner.stop();
  });
}

try {
  await runner.run();
} finally {
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
