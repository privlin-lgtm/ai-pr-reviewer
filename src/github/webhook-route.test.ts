import assert from "node:assert/strict";
import test from "node:test";

import { handleGitHubWebhookRequest } from "./webhook-route.js";
import type { PullRequestWebhookEvent } from "./types.js";

const payload = JSON.stringify({
  action: "opened",
  installation: { id: 12 },
  number: 42,
  pull_request: { head: { sha: "abc" }, id: 13 },
  repository: { id: 14, name: "repo", owner: { login: "octocat" } },
});

function request(body = payload): Request {
  return new Request("https://reviewer.example/api/github/webhook", {
    body,
    headers: {
      "content-type": "application/json",
      "x-github-delivery": "delivery-1",
      "x-github-event": "pull_request",
      "x-hub-signature-256": "sha256=valid",
    },
    method: "POST",
  });
}

function dependencies(overrides: Partial<{
  allowed: boolean;
  verifier: (body: string, signature: string | undefined) => Promise<boolean>;
}> = {}) {
  const events: PullRequestWebhookEvent[] = [];
  return {
    dependencies: {
      maximumBodyBytes: 1_024,
      queue: { enqueue: async (event: PullRequestWebhookEvent) => { events.push(event); } },
      rateLimiter: {
        consume: async () => ({
          allowed: overrides.allowed ?? true,
          retryAfterSeconds: 17,
        }),
      },
      signatureVerifier: {
        verify: overrides.verifier ?? (async () => true),
      },
    },
    events,
  };
}

test("accepts a verified bounded delivery only after durable rate-limit approval", async () => {
  const { dependencies: routeDependencies, events } = dependencies();

  const response = await handleGitHubWebhookRequest(request(), routeDependencies);

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(events, [{
    action: "opened",
    deliveryId: "delivery-1",
    installationId: 12,
    pullRequest: { headSha: "abc", id: 13, number: 42 },
    repository: { id: 14, name: "repo", owner: "octocat" },
  }]);
});

test("rejects an oversized raw body before signature verification", async () => {
  let verificationCalls = 0;
  const { dependencies: routeDependencies } = dependencies({
    verifier: async () => {
      verificationCalls += 1;
      return true;
    },
  });
  routeDependencies.maximumBodyBytes = 10;

  const response = await handleGitHubWebhookRequest(request(payload), routeDependencies);

  assert.equal(response.status, 413);
  assert.equal(verificationCalls, 0);
});

test("uses safe authentication, validation, and throttling status semantics", async () => {
  const invalidSignature = dependencies({ verifier: async () => false });
  assert.equal(
    (await handleGitHubWebhookRequest(request("not json"), invalidSignature.dependencies)).status,
    401,
  );

  const malformed = dependencies();
  assert.equal(
    (await handleGitHubWebhookRequest(request("{}"), malformed.dependencies)).status,
    400,
  );

  const throttled = dependencies({ allowed: false });
  const response = await handleGitHubWebhookRequest(request(), throttled.dependencies);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "17");
  assert.equal(throttled.events.length, 0);
});
