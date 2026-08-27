import type { PullRequestRiskCategory } from "../risk/types.js";

export interface DashboardMetrics {
  averageRiskScore: number | null;
  openFindings: number;
  pullRequestsReviewed: number;
  totalRepositories: number;
}

export interface DashboardCategory {
  category: string;
  count: number;
}

export interface DashboardReviewHistoryItem {
  createdAt: string;
  findingCount: number;
  id: string;
  pullRequestNumber: number;
  repositoryName: string;
  riskCategory: PullRequestRiskCategory | "UNASSESSED";
  riskScore: number | null;
  status: string;
  title: string;
}

export interface DashboardData {
  categories: DashboardCategory[];
  history: DashboardReviewHistoryItem[];
  metrics: DashboardMetrics;
}

export type DashboardLoadResult =
  | { data: DashboardData; status: "ready" }
  | { data: DashboardData; status: "demo" }
  | { status: "unauthenticated" }
  | { status: "unconfigured" }
  | { message: string; status: "unavailable" };
