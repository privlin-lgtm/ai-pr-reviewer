import type { PrismaClient } from "@prisma/client";

import { categoryForRiskScore } from "../risk/pull-request-risk-scorer";
import { loadScopedDashboardDataCore } from "./dashboard-query-core.js";
import type { DashboardScope } from "./scope";
import type {
  DashboardData,
  DashboardReviewHistoryItem,
} from "./types";

export async function loadScopedDashboardData(
  prisma: PrismaClient,
  scope: DashboardScope,
): Promise<DashboardData> {
  return loadScopedDashboardDataCore(
    prisma,
    scope.repositoryIds,
    toRiskCategory,
  ) as Promise<DashboardData>;
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
