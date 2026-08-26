import assert from "node:assert/strict";
import test from "node:test";

import { loadScopedDashboardDataCore } from "./dashboard-query-core.js";
import { resolveDashboardScope } from "./scope.js";

test("fails closed when there is no dashboard identity", async () => {
  const prisma = {
    repositoryMembership: {
      findMany: async () => assert.fail("membership lookup should not run"),
    },
  };

  assert.equal(await resolveDashboardScope(prisma as never, null), null);
});

test("resolves membership-only scopes and applies them to every dashboard query", async () => {
  const calls: unknown[] = [];
  const prisma = {
    finding: {
      count: async (argument: unknown) => { calls.push(argument); return 2; },
      groupBy: async (argument: unknown) => {
        calls.push(argument);
        return [{ _count: { category: 2 }, category: "SECURITY" }];
      },
    },
    repository: {
      count: async (argument: unknown) => { calls.push(argument); return 1; },
    },
    repositoryMembership: {
      findMany: async () => [{ repositoryId: "repo-a" }],
    },
    review: {
      aggregate: async (argument: unknown) => {
        calls.push(argument);
        return { _avg: { riskScore: 6 } };
      },
      count: async (argument: unknown) => { calls.push(argument); return 3; },
      findMany: async (argument: unknown) => {
        calls.push(argument);
        return [{
          _count: { findings: 1 },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          id: "review-a",
          pullRequest: {
            number: 4,
            repository: { fullName: "octocat/private" },
            title: "Scoped review",
          },
          riskScore: 6,
          status: "COMPLETED",
        }];
      },
    },
  };

  const scope = await resolveDashboardScope(prisma as never, { userId: "user-a" });
  assert.deepEqual(scope, { repositoryIds: ["repo-a"], userId: "user-a" });
  const data = await loadScopedDashboardDataCore(
    prisma,
    scope!.repositoryIds,
    (riskScore: number | null) => riskScore === null ? "UNASSESSED" : "MEDIUM",
  );

  assert.equal(data.metrics.totalRepositories, 1);
  assert.equal(data.history[0]?.repositoryName, "octocat/private");
  assert.equal(calls.length, 6);
  for (const call of calls) {
    assert.match(JSON.stringify(call), /repo-a/);
  }
});
