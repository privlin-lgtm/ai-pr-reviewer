import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { PrismaReviewJobStore } from "./prisma-review-job-store.js";

const enabled = process.env.RUN_PGVECTOR_INTEGRATION === "1";
const LEASE_MILLISECONDS = 60_000;

for (const timeZone of ["America/Los_Angeles", "Asia/Jerusalem", "UTC"]) {
  test(
    `claims, leases and completes review jobs with the session time zone ${timeZone}`,
    { skip: !enabled },
    async () => {
      const connectionString = process.env.DATABASE_URL;
      assert.ok(connectionString, "DATABASE_URL is required for integration tests.");
      const prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString, options: `-c TimeZone=${timeZone}` }),
      });
      const workerId = `tz-${randomUUID()}`;
      const store = new PrismaReviewJobStore(prisma, {
        leaseDurationMilliseconds: LEASE_MILLISECONDS,
      });
      try {
        await prisma.reviewJob.updateMany({
          data: { status: "COMPLETED" },
          where: { status: { in: ["QUEUED", "PROCESSING"] } },
        });
        const job = await prisma.reviewJob.create({
          data: {
            headSha: randomUUID(),
            installationGithubId: 1n,
            owner: "octocat",
            pullRequestNumber: 1,
            repositoryGithubId: 1n,
            repositoryName: "repo",
          },
        });

        const claimed = await store.claimNext(workerId);
        assert.equal(claimed?.id, job.id, "a job due now must be claimable");

        const leased = await prisma.reviewJob.findUniqueOrThrow({ where: { id: job.id } });
        const remaining = (leased.leaseExpiresAt?.valueOf() ?? 0) - Date.now();
        assert.ok(
          remaining > 0 && remaining <= LEASE_MILLISECONDS,
          `lease must end within ${LEASE_MILLISECONDS}ms, ended in ${remaining}ms`,
        );

        assert.equal(await store.claimNext(`${workerId}-other`), null, "a live lease must not be stolen");
        assert.equal(await store.heartbeat(job.id, workerId), true);
        assert.equal(await store.complete(job.id, workerId), true);
      } finally {
        await prisma.reviewJob.deleteMany({ where: { lockedBy: workerId } });
        await prisma.$disconnect();
      }
    },
  );
}
