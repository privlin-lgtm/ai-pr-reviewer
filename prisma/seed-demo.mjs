import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the optional demo fixture.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const now = new Date();

try {
  const user = await prisma.user.upsert({
    create: {
      displayName: "Demo Maintainer",
      githubLogin: "demo-maintainer",
      githubUserId: 9_001n,
    },
    update: { displayName: "Demo Maintainer" },
    where: { githubUserId: 9_001n },
  });
  const installation = await prisma.gitHubInstallation.upsert({
    create: {
      accountLogin: "demo-org",
      accountType: "Organization",
      githubInstallationId: 9_002n,
    },
    update: {},
    where: { githubInstallationId: 9_002n },
  });
  const repository = await prisma.repository.upsert({
    create: {
      defaultBranch: "main",
      fullName: "demo-org/reliable-review-demo",
      githubRepositoryId: 9_003n,
      installationId: installation.id,
      name: "reliable-review-demo",
      ownerLogin: "demo-org",
    },
    update: { isEnabled: true },
    where: { githubRepositoryId: 9_003n },
  });
  await prisma.repositoryMembership.upsert({
    create: { repositoryId: repository.id, role: "ADMIN", userId: user.id },
    update: { role: "ADMIN" },
    where: { userId_repositoryId: { repositoryId: repository.id, userId: user.id } },
  });
  const pullRequest = await prisma.pullRequest.upsert({
    create: {
      authorGithubLogin: "demo-contributor",
      baseBranch: "main",
      baseSha: "demo-base-sha",
      githubCreatedAt: now,
      githubPullRequestId: 9_004n,
      githubUpdatedAt: now,
      headBranch: "fix/webhook-limits",
      headSha: "demo-head-sha",
      isDraft: false,
      number: 42,
      repositoryId: repository.id,
      state: "OPEN",
      title: "Harden webhook ingestion",
    },
    update: { githubUpdatedAt: now, headSha: "demo-head-sha" },
    where: { githubPullRequestId: 9_004n },
  });
  const review = await prisma.review.upsert({
    create: {
      completedAt: now,
      headSha: "demo-head-sha",
      modelName: "demo-fixture",
      promptVersion: "demo-v1",
      pullRequestId: pullRequest.id,
      riskScore: 7,
      startedAt: now,
      status: "COMPLETED",
      summary: "Demo fixture review. No external GitHub review was posted.",
      trigger: "MANUAL",
    },
    update: {
      completedAt: now,
      riskScore: 7,
      status: "COMPLETED",
      summary: "Demo fixture review. No external GitHub review was posted.",
    },
    where: {
      pullRequestId_headSha: {
        headSha: "demo-head-sha",
        pullRequestId: pullRequest.id,
      },
    },
  });
  await prisma.finding.upsert({
    create: {
      category: "SECURITY",
      confidence: 0.91,
      endLine: 24,
      evidence: { source: "demo-fixture" },
      fingerprint: "demo-webhook-rate-limit",
      path: "src/github/webhook-route.ts",
      rationale: "A demo finding illustrating the dashboard's persisted-data rendering.",
      reviewId: review.id,
      severity: "HIGH",
      side: "RIGHT",
      startLine: 20,
      status: "SUPPRESSED",
      suggestedFix: "Use the durable rate limiter before queueing the event.",
      title: "Demo: persist ingress rate limits",
    },
    update: {
      rationale: "A demo finding illustrating the dashboard's persisted-data rendering.",
      status: "SUPPRESSED",
    },
    where: {
      reviewId_fingerprint: {
        fingerprint: "demo-webhook-rate-limit",
        reviewId: review.id,
      },
    },
  });
  await prisma.reviewMetrics.upsert({
    create: {
      commentsPublished: 0,
      durationMs: 840,
      filesAnalyzed: 3,
      filesChanged: 3,
      modelCallCount: 0,
      reviewId: review.id,
    },
    update: {
      commentsPublished: 0,
      durationMs: 840,
      filesAnalyzed: 3,
      filesChanged: 3,
      modelCallCount: 0,
    },
    where: { reviewId: review.id },
  });
  console.log(JSON.stringify({
    event: "demo_fixture_seeded",
    repositoryId: repository.id,
    reviewId: review.id,
  }));
} finally {
  await prisma.$disconnect();
}
