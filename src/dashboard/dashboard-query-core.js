export async function loadScopedDashboardDataCore(
  prisma,
  repositoryIds,
  toRiskCategory,
) {
  const [
    totalRepositories,
    pullRequestsReviewed,
    averageRisk,
    openFindings,
    categories,
    history,
  ] = await Promise.all([
    prisma.repository.count({ where: { id: { in: repositoryIds } } }),
    prisma.review.count({
      where: {
        pullRequest: { repositoryId: { in: repositoryIds } },
        status: "COMPLETED",
      },
    }),
    prisma.review.aggregate({
      _avg: { riskScore: true },
      where: {
        pullRequest: { repositoryId: { in: repositoryIds } },
        riskScore: { not: null },
      },
    }),
    prisma.finding.count({
      where: {
        review: { pullRequest: { repositoryId: { in: repositoryIds } } },
        status: "PENDING",
      },
    }),
    prisma.finding.groupBy({
      by: ["category"],
      _count: { category: true },
      orderBy: { _count: { category: "desc" } },
      take: 5,
      where: {
        review: { pullRequest: { repositoryId: { in: repositoryIds } } },
      },
    }),
    prisma.review.findMany({
      include: {
        _count: { select: { findings: true } },
        pullRequest: { include: { repository: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
      where: { pullRequest: { repositoryId: { in: repositoryIds } } },
    }),
  ]);

  return {
    categories: categories.map((item) => ({
      category: item.category,
      count: item._count.category,
    })),
    history: history.map((review) => ({
      createdAt: review.createdAt.toISOString(),
      findingCount: review._count.findings,
      id: review.id,
      pullRequestNumber: review.pullRequest.number,
      repositoryName: review.pullRequest.repository.fullName,
      riskCategory: toRiskCategory(review.riskScore),
      riskScore: review.riskScore,
      status: review.status,
      title: review.pullRequest.title,
    })),
    metrics: {
      averageRiskScore:
        averageRisk._avg.riskScore === null
          ? null
          : Number(averageRisk._avg.riskScore.toFixed(1)),
      openFindings,
      pullRequestsReviewed,
      totalRepositories,
    },
  };
}
