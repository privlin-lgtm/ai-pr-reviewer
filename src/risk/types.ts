export type PullRequestRiskCategory = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type PullRequestRiskFactorId =
  | "BASELINE"
  | "FILES_CHANGED"
  | "SECURITY_FINDINGS"
  | "AUTHENTICATION_CHANGE"
  | "DATABASE_MIGRATION"
  | "API_CHANGE"
  | "HIGH_SEVERITY_ISSUES";

export interface PullRequestRiskInput {
  authenticationChanged: boolean;
  databaseMigrationChanged: boolean;
  filesChanged: number;
  highSeverityIssueCount: number;
  publicApiChanged: boolean;
  securityFindingCount: number;
}

export interface PullRequestRiskFactor {
  contribution: number;
  id: PullRequestRiskFactorId;
  label: string;
  reason: string;
  value: boolean | number;
}

export interface PullRequestRiskAssessment {
  category: PullRequestRiskCategory;
  factors: PullRequestRiskFactor[];
  reasons: string[];
  score: number;
}
