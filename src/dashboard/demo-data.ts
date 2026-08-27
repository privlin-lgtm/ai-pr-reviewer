import type { DashboardData } from "./types.js";

export const dashboardDemoData: DashboardData = {
  categories: [
    { category: "SECURITY", count: 8 },
    { category: "RELIABILITY", count: 6 },
    { category: "CORRECTNESS", count: 5 },
    { category: "PERFORMANCE", count: 3 },
    { category: "MAINTAINABILITY", count: 2 },
  ],
  history: [
    {
      createdAt: "2026-08-26T14:42:00.000Z",
      findingCount: 3,
      id: "demo-review-001",
      pullRequestNumber: 184,
      repositoryName: "acme/payments-api",
      riskCategory: "HIGH",
      riskScore: 8,
      status: "COMPLETED",
      title: "Validate idempotency keys before charging",
    },
    {
      createdAt: "2026-08-25T11:18:00.000Z",
      findingCount: 1,
      id: "demo-review-002",
      pullRequestNumber: 92,
      repositoryName: "acme/customer-portal",
      riskCategory: "MEDIUM",
      riskScore: 5,
      status: "COMPLETED",
      title: "Add organization audit-log filters",
    },
    {
      createdAt: "2026-08-24T16:06:00.000Z",
      findingCount: 4,
      id: "demo-review-003",
      pullRequestNumber: 317,
      repositoryName: "acme/platform-infra",
      riskCategory: "CRITICAL",
      riskScore: 9,
      status: "COMPLETED",
      title: "Rotate service-token signing key",
    },
    {
      createdAt: "2026-08-23T09:31:00.000Z",
      findingCount: 0,
      id: "demo-review-004",
      pullRequestNumber: 48,
      repositoryName: "acme/design-system",
      riskCategory: "LOW",
      riskScore: 2,
      status: "COMPLETED",
      title: "Refine accessible dialog focus styles",
    },
  ],
  metrics: {
    averageRiskScore: 5.8,
    openFindings: 6,
    pullRequestsReviewed: 27,
    totalRepositories: 4,
  },
};

export function isDashboardDemoMode(
  environment: Readonly<{
    DASHBOARD_DEMO_MODE?: string;
    NODE_ENV?: string;
  }> = process.env,
): boolean {
  return environment.NODE_ENV === "development" && environment.DASHBOARD_DEMO_MODE === "true";
}
