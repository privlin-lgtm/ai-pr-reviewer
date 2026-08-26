import assert from "node:assert/strict";
import test from "node:test";

import { InvalidWebhookSignatureError } from "./errors.js";
import { PullRequestWebhookHandler } from "./webhook-handler.js";
import type {
  PullRequestAnalysisEnqueuer,
  PullRequestWebhookEvent,
  WebhookSignatureVerifier,
} from "./types.js";

class AcceptingSignatureVerifier implements WebhookSignatureVerifier {
  async verify(): Promise<boolean> {
    return true;
  }
}

class RecordingEnqueuer implements PullRequestAnalysisEnqueuer {
  readonly events: PullRequestWebhookEvent[] = [];

  async enqueue(event: PullRequestWebhookEvent): Promise<void> {
    this.events.push(event);
  }
}

test("accepts opened and synchronize pull request webhooks only after verification", async () => {
  const enqueuer = new RecordingEnqueuer();
  const handler = new PullRequestWebhookHandler(new AcceptingSignatureVerifier(), enqueuer);

  for (const action of ["opened", "synchronize"] as const) {
    const result = await handler.handle({
      body: JSON.stringify({
        action,
        installation: { id: 12_345 },
        number: 42,
        pull_request: { id: 54_321, head: { sha: "abc123" } },
        repository: { id: 99, name: "ai-pr-reviewer", owner: { login: "octocat" } },
      }),
      deliveryId: `delivery-${action}`,
      eventName: "pull_request",
      signature: "sha256=valid",
    });

    assert.equal(result.status, "accepted");
  }

  assert.deepEqual(enqueuer.events, [
    {
      action: "opened",
      deliveryId: "delivery-opened",
      installationId: 12_345,
      repository: { id: 99, owner: "octocat", name: "ai-pr-reviewer" },
      pullRequest: { id: 54_321, number: 42, headSha: "abc123" },
    },
    {
      action: "synchronize",
      deliveryId: "delivery-synchronize",
      installationId: 12_345,
      repository: { id: 99, owner: "octocat", name: "ai-pr-reviewer" },
      pullRequest: { id: 54_321, number: 42, headSha: "abc123" },
    },
  ]);
});

test("rejects an invalid signature before parsing or enqueueing the payload", async () => {
  const enqueuer = new RecordingEnqueuer();
  const handler = new PullRequestWebhookHandler(
    { verify: async () => false },
    enqueuer,
  );

  await assert.rejects(
    handler.handle({
      body: "not JSON",
      deliveryId: "delivery-2",
      eventName: "pull_request",
      signature: "sha256=invalid",
    }),
    InvalidWebhookSignatureError,
  );

  assert.equal(enqueuer.events.length, 0);
});
