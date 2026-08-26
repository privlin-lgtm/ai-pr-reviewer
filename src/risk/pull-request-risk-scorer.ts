import type {
  PullRequestRiskAssessment,
  PullRequestRiskCategory,
  PullRequestRiskFactor,
  PullRequestRiskInput,
} from "./types.js";

export const PULL_REQUEST_RISK_POLICY = {
  baselineScore: 1,
  categories: {
    LOW: { minimumScore: 1, maximumScore: 3 },
    MEDIUM: { minimumScore: 4, maximumScore: 6 },
    HIGH: { minimumScore: 7, maximumScore: 8 },
    CRITICAL: { minimumScore: 9, maximumScore: 10 },
  },
  factors: {
    apiChange: 1,
    authenticationChange: 2,
    databaseMigration: 2,
    filesChanged: [
      { minimumFiles: 41, contribution: 3 },
      { minimumFiles: 16, contribution: 2 },
      { minimumFiles: 6, contribution: 1 },
    ],
    highSeverityIssues: { contributionPerIssue: 2, maximumIssues: 2 },
    securityFindings: { contributionPerFinding: 1, maximumFindings: 3 },
  },
  maximumScore: 10,
  minimumScore: 1,
} as const;

export class PullRequestRiskScorer {
  score(input: PullRequestRiskInput): PullRequestRiskAssessment {
    validateInput(input);

    const factors = [
      baselineFactor(),
      filesChangedFactor(input.filesChanged),
      securityFindingsFactor(input.securityFindingCount),
      booleanFactor(
        "AUTHENTICATION_CHANGE",
        "Authentication change",
        input.authenticationChanged,
        PULL_REQUEST_RISK_POLICY.factors.authenticationChange,
        "Authentication or authorization behavior changed.",
      ),
      booleanFactor(
        "DATABASE_MIGRATION",
        "Database migration",
        input.databaseMigrationChanged,
        PULL_REQUEST_RISK_POLICY.factors.databaseMigration,
        "A database schema migration changed.",
      ),
      booleanFactor(
        "API_CHANGE",
        "Public API change",
        input.publicApiChanged,
        PULL_REQUEST_RISK_POLICY.factors.apiChange,
        "A public API contract changed.",
      ),
      highSeverityIssuesFactor(input.highSeverityIssueCount),
    ];

    const unclampedScore = factors.reduce(
      (total, factor) => total + factor.contribution,
      0,
    );
    const score = clampScore(unclampedScore);

    return {
      category: categoryForRiskScore(score),
      factors,
      reasons: factors
        .filter((factor) => factor.contribution > 0)
        .map((factor) => factor.reason),
      score,
    };
  }
}

export function categoryForRiskScore(score: number): PullRequestRiskCategory {
  if (!Number.isInteger(score) || score < PULL_REQUEST_RISK_POLICY.minimumScore || score > PULL_REQUEST_RISK_POLICY.maximumScore) {
    throw new RangeError("Risk category requires an integer score from 1 to 10.");
  }

  if (score <= PULL_REQUEST_RISK_POLICY.categories.LOW.maximumScore) {
    return "LOW";
  }

  if (score <= PULL_REQUEST_RISK_POLICY.categories.MEDIUM.maximumScore) {
    return "MEDIUM";
  }

  if (score <= PULL_REQUEST_RISK_POLICY.categories.HIGH.maximumScore) {
    return "HIGH";
  }

  return "CRITICAL";
}

export function clampScore(score: number): number {
  return Math.min(
    PULL_REQUEST_RISK_POLICY.maximumScore,
    Math.max(PULL_REQUEST_RISK_POLICY.minimumScore, score),
  );
}

function baselineFactor(): PullRequestRiskFactor {
  return {
    contribution: PULL_REQUEST_RISK_POLICY.baselineScore,
    id: "BASELINE",
    label: "Baseline",
    reason: "Every pull request starts at the minimum review risk.",
    value: PULL_REQUEST_RISK_POLICY.baselineScore,
  };
}

function filesChangedFactor(filesChanged: number): PullRequestRiskFactor {
  const tier = PULL_REQUEST_RISK_POLICY.factors.filesChanged.find(
    (candidate) => filesChanged >= candidate.minimumFiles,
  );
  const contribution = tier?.contribution ?? 0;

  return {
    contribution,
    id: "FILES_CHANGED",
    label: "Files changed",
    reason:
      contribution === 0
        ? "Change volume is within the low-risk file threshold."
        : `${filesChanged} files changed reached the ${tier!.minimumFiles}-file risk tier.`,
    value: filesChanged,
  };
}

function securityFindingsFactor(securityFindingCount: number): PullRequestRiskFactor {
  const policy = PULL_REQUEST_RISK_POLICY.factors.securityFindings;
  const countedFindings = Math.min(securityFindingCount, policy.maximumFindings);
  const contribution = countedFindings * policy.contributionPerFinding;

  return {
    contribution,
    id: "SECURITY_FINDINGS",
    label: "Security findings",
    reason:
      contribution === 0
        ? "No security findings were reported."
        : `${countedFindings} security finding(s) contributed to the score.`,
    value: securityFindingCount,
  };
}

function highSeverityIssuesFactor(highSeverityIssueCount: number): PullRequestRiskFactor {
  const policy = PULL_REQUEST_RISK_POLICY.factors.highSeverityIssues;
  const countedIssues = Math.min(highSeverityIssueCount, policy.maximumIssues);
  const contribution = countedIssues * policy.contributionPerIssue;

  return {
    contribution,
    id: "HIGH_SEVERITY_ISSUES",
    label: "High-severity issues",
    reason:
      contribution === 0
        ? "No high-severity issues were reported."
        : `${countedIssues} high-severity issue(s) contributed to the score.`,
    value: highSeverityIssueCount,
  };
}

function booleanFactor(
  id: PullRequestRiskFactor["id"],
  label: string,
  value: boolean,
  contribution: number,
  activeReason: string,
): PullRequestRiskFactor {
  return {
    contribution: value ? contribution : 0,
    id,
    label,
    reason: value ? activeReason : `${label} was not changed.`,
    value,
  };
}

function validateInput(input: PullRequestRiskInput): void {
  validateNonNegativeInteger(input.filesChanged, "filesChanged");
  validateNonNegativeInteger(input.securityFindingCount, "securityFindingCount");
  validateNonNegativeInteger(input.highSeverityIssueCount, "highSeverityIssueCount");

  for (const [name, value] of Object.entries({
    authenticationChanged: input.authenticationChanged,
    databaseMigrationChanged: input.databaseMigrationChanged,
    publicApiChanged: input.publicApiChanged,
  })) {
    if (typeof value !== "boolean") {
      throw new TypeError(`${name} must be a boolean.`);
    }
  }
}

function validateNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
}
