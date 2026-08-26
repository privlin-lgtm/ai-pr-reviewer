import assert from "node:assert/strict";
import test from "node:test";

import { isTransientGitHubFailure, retryTransient } from "./retry.js";

test("retries a rate-limited GitHub operation using Retry-After", async () => {
  let attempts = 0;
  const delays: number[] = [];

  const result = await retryTransient(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw { status: 429, response: { headers: { "retry-after": "2" } } };
      }

      return "published";
    },
    {
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
    },
  );

  assert.equal(result, "published");
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [2_000]);
});

test("does not retry a non-transient GitHub failure", async () => {
  await assert.rejects(
    retryTransient(
      async () => {
        throw { status: 422 };
      },
      { delay: async () => undefined },
    ),
  );

  assert.equal(isTransientGitHubFailure({ status: 422 }), false);
  assert.equal(isTransientGitHubFailure({ status: 503 }), true);
});
