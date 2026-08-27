import { Webhooks } from "@octokit/webhooks";

import { loadGitHubAppConfig } from "../../../../src/github/config";
import { handleGitHubWebhookRequest } from "../../../../src/github/webhook-route";
import { PrismaWebhookRateLimiter } from "../../../../src/github/webhook-rate-limiter";
import { PrismaReviewJobQueue } from "../../../../src/reviews/review-job-queue";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const { prisma } = await import("../../../../src/lib/prisma");
    const config = loadGitHubAppConfig();
    return handleGitHubWebhookRequest(request, {
      maximumBodyBytes: parsePositiveInteger(
        process.env.GITHUB_WEBHOOK_MAX_BYTES,
        1_048_576,
        "GITHUB_WEBHOOK_MAX_BYTES",
      ),
      queue: new PrismaReviewJobQueue(prisma),
      rateLimiter: new PrismaWebhookRateLimiter(prisma, {
        limit: parsePositiveInteger(
          process.env.GITHUB_WEBHOOK_RATE_LIMIT,
          120,
          "GITHUB_WEBHOOK_RATE_LIMIT",
        ),
        windowMilliseconds: parsePositiveInteger(
          process.env.GITHUB_WEBHOOK_RATE_WINDOW_MS,
          60_000,
          "GITHUB_WEBHOOK_RATE_WINDOW_MS",
        ),
      }),
      signatureVerifier: {
        verify: async (body, signature) =>
          signature !== undefined &&
          new Webhooks({ secret: config.webhookSecret }).verify(body, signature),
      },
    });
  } catch {
    return Response.json(
      { error: "Webhook ingress is temporarily unavailable." },
      { headers: { "cache-control": "no-store" }, status: 503 },
    );
  }
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
