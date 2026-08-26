import assert from "node:assert/strict";
import test from "node:test";

import { PrismaReviewJobQueue } from "./review-job-queue.js";

test("deduplicates a webhook delivery while preserving its first durable job", async () => {
  const deliveries = new Set<string>();
  const creates: unknown[] = [];
  const transaction = {
    reviewJob: {
      upsert: async () => ({ id: "job-1" }),
    },
    webhookDelivery: {
      create: async ({ data }: { data: { githubDeliveryId: string } }) => {
        deliveries.add(data.githubDeliveryId);
        creates.push(data);
      },
      findUnique: async ({ where }: { where: { githubDeliveryId: string } }) =>
        deliveries.has(where.githubDeliveryId) ? { id: "delivery-1" } : null,
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
      callback(transaction),
  };
  const queue = new PrismaReviewJobQueue(
    prisma as never,
  );
  const event = {
    action: "opened" as const,
    deliveryId: "delivery-1",
    installationId: 7,
    pullRequest: { headSha: "abc", id: 8, number: 9 },
    repository: { id: 10, name: "repo", owner: "octocat" },
  };

  await queue.enqueue(event);
  await queue.enqueue(event);

  assert.equal(creates.length, 1);
});
