import { Webhooks } from "@octokit/webhooks";

import { loadGitHubAppConfig } from "../../../../src/github/config";
import { PrismaReviewJobQueue } from "../../../../src/reviews/review-job-queue";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.text();
    const { prisma } = await import("../../../../src/lib/prisma");
    const config = loadGitHubAppConfig();
    const signature = request.headers.get("x-hub-signature-256");
    const verified =
      signature !== null &&
      (await new Webhooks({ secret: config.webhookSecret }).verify(body, signature));
    if (!verified) {
      return Response.json({ error: "Invalid GitHub webhook signature." }, { status: 401 });
    }

    const eventName = request.headers.get("x-github-event");
    if (eventName !== "pull_request") {
      return new Response(null, { status: 204 });
    }

    const event = parsePullRequestEvent(
      body,
      request.headers.get("x-github-delivery") ?? "",
    );
    if (event === null) {
      return new Response(null, { status: 204 });
    }

    await new PrismaReviewJobQueue(prisma).enqueue(event);

    return Response.json({ status: "accepted" }, { status: 202 });
  } catch (error) {
    console.error("GitHub webhook ingestion failed.", error);
    return Response.json(
      { error: "Webhook delivery could not be persisted. GitHub may retry it." },
      { status: 503 },
    );
  }
}

function parsePullRequestEvent(body: string, deliveryId: string) {
  const payload: unknown = JSON.parse(body);
  if (deliveryId.length === 0 || !isRecord(payload) || !isRecord(payload["repository"]) || !isRecord(payload["pull_request"]) || !isRecord(payload["installation"])) {
    throw new Error("Invalid pull_request webhook payload.");
  }

  const action = payload["action"];
  if (action !== "opened" && action !== "synchronize") {
    return null;
  }

  const repository = payload["repository"];
  const owner = isRecord(repository["owner"]) ? repository["owner"] : null;
  const pullRequest = payload["pull_request"];
  const head = isRecord(pullRequest["head"]) ? pullRequest["head"] : null;
  const installation = payload["installation"];
  if (
    owner === null ||
    head === null ||
    typeof repository["id"] !== "number" ||
    typeof repository["name"] !== "string" ||
    typeof owner["login"] !== "string" ||
    typeof payload["number"] !== "number" ||
    typeof pullRequest["id"] !== "number" ||
    typeof head["sha"] !== "string" ||
    typeof installation["id"] !== "number"
  ) {
    throw new Error("Invalid pull_request webhook fields.");
  }

  return {
    action: action as "opened" | "synchronize",
    deliveryId,
    installationId: installation["id"],
    repository: { id: repository["id"], name: repository["name"], owner: owner["login"] },
    pullRequest: { headSha: head["sha"], id: pullRequest["id"], number: payload["number"] },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
