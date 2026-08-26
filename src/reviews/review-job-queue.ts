import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import type {
  PullRequestAnalysisEnqueuer,
  PullRequestWebhookEvent,
} from "../github/types.js";

export class PrismaReviewJobQueue implements PullRequestAnalysisEnqueuer {
  constructor(private readonly prisma: PrismaClient) {}

  async enqueue(event: PullRequestWebhookEvent): Promise<void> {
    const payloadHash = createHash("sha256")
      .update(
        JSON.stringify({
          action: event.action,
          headSha: event.pullRequest.headSha,
          installationId: event.installationId,
          pullRequestNumber: event.pullRequest.number,
          repositoryId: event.repository.id,
        }),
      )
      .digest("hex");

    try {
      await this.prisma.$transaction(async (transaction) => {
        const existingDelivery = await transaction.webhookDelivery.findUnique({
          where: { githubDeliveryId: event.deliveryId },
        });
        if (existingDelivery !== null) {
          return;
        }

        const job = await transaction.reviewJob.upsert({
          where: {
            repositoryGithubId_pullRequestNumber_headSha: {
              headSha: event.pullRequest.headSha,
              pullRequestNumber: event.pullRequest.number,
              repositoryGithubId: BigInt(event.repository.id),
            },
          },
          create: {
            headSha: event.pullRequest.headSha,
            installationGithubId: BigInt(event.installationId),
            owner: event.repository.owner,
            pullRequestNumber: event.pullRequest.number,
            repositoryGithubId: BigInt(event.repository.id),
            repositoryName: event.repository.name,
          },
          update: {},
        });

        await transaction.webhookDelivery.create({
          data: {
            action: event.action,
            eventName: "pull_request",
            githubDeliveryId: event.deliveryId,
            payloadHash,
            reviewJobId: job.id,
            status: "ENQUEUED",
          },
        });
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return;
      }

      throw error;
    }
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
