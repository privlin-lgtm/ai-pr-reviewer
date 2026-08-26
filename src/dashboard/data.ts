import "server-only";

import { categoryForRiskScore } from "../risk/pull-request-risk-scorer";
import type {
  DashboardData,
  DashboardLoadResult,
  DashboardReviewHistoryItem,
} from "./types";

const REVIEW_HISTORY_LIMIT = 12;
const CATEGORY_LIMIT = 5;

export async function loadDashboardData(): Promise<DashboardLoadResult> {
  if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL.trim().length === 0) {
    return { status: "unconfigured" };
  }

  try {
    const { prisma } = await import("../lib/prisma");
    const [
      totalRepositories,
      pullRequestsReviewed,
      averageRisk,
      openFindings,
      categories,
      history,
    ] = await Promise.all([
      prisma.repository.count(),
      prisma.review.count({ where: { status: "COMPLETED" } }),
      prisma.review.aggregate({
        _avg: { riskScore: true },
        where: { riskScore: { not: null } },
      }),
      prisma.finding.count({ where: { status: "PENDING" } }),
      prisma.finding.groupBy({
        by: ["category"],
        _count: { category: true },
        orderBy: { _count: { category: "desc" } },
        take: CATEGORY_LIMIT,
      }),
      prisma.review.findMany({
        include: {
          _count: { select: { findings: true } },
          pullRequest: { include: { repository: true } },
        },
        orderBy: { createdAt: "desc" },
        take: REVIEW_HISTORY_LIMIT,
      }),
    ]);

    const data: DashboardData = {
      categories: categories.map((item) => ({
        category: item.category,
        count: item._count.category,
      })),
      history: history.map((review): DashboardReviewHistoryItem => ({
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

    return { data, status: "ready" };
  } catch (error) {
    console.error("Dashboard data loading failed.", error);
    return {
      message:
        "The dashboard could not reach PostgreSQL. Check DATABASE_URL, Prisma migrations, and the database service before retrying.",
      status: "unavailable",
    };
  }
}

function toRiskCategory(riskScore: number | null): DashboardReviewHistoryItem["riskCategory"] {
  if (
    riskScore === null ||
    !Number.isInteger(riskScore) ||
    riskScore < 1 ||
    riskScore > 10
  ) {
    return "UNASSESSED";
  }

  return categoryForRiskScore(riskScore);
}
