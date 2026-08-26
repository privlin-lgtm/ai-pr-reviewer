import assert from "node:assert/strict";
import test from "node:test";

import {
  categoryForRiskScore,
  PullRequestRiskScorer,
} from "./pull-request-risk-scorer.js";
import type { PullRequestRiskInput } from "./types.js";

const baselineInput: PullRequestRiskInput = {
  authenticationChanged: false,
  databaseMigrationChanged: false,
  filesChanged: 1,
  highSeverityIssueCount: 0,
  publicApiChanged: false,
  securityFindingCount: 0,
};

const scorer = new PullRequestRiskScorer();

test("scores a small pull request at the baseline", () => {
  const assessment = scorer.score(baselineInput);

  assert.equal(assessment.score, 1);
  assert.equal(assessment.category, "LOW");
  assert.equal(assessment.factors.length, 7);
  assert.deepEqual(assessment.reasons, ["Every pull request starts at the minimum review risk."]);
});

test("applies explicit file-change thresholds", () => {
  assert.equal(scorer.score({ ...baselineInput, filesChanged: 5 }).score, 1);
  assert.equal(scorer.score({ ...baselineInput, filesChanged: 6 }).score, 2);
  assert.equal(scorer.score({ ...baselineInput, filesChanged: 16 }).score, 3);
  assert.equal(scorer.score({ ...baselineInput, filesChanged: 41 }).score, 4);
});

test("scores each high-impact change factor deterministically", () => {
  assert.equal(
    scorer.score({ ...baselineInput, securityFindingCount: 2 }).score,
    3,
  );
  assert.equal(
    scorer.score({ ...baselineInput, authenticationChanged: true }).score,
    3,
  );
  assert.equal(
    scorer.score({ ...baselineInput, databaseMigrationChanged: true }).score,
    3,
  );
  assert.equal(
    scorer.score({ ...baselineInput, publicApiChanged: true }).score,
    2,
  );
  assert.equal(
    scorer.score({ ...baselineInput, highSeverityIssueCount: 1 }).score,
    3,
  );
});

test("caps individual contributions and clamps the final score", () => {
  const assessment = scorer.score({
    authenticationChanged: true,
    databaseMigrationChanged: true,
    filesChanged: 100,
    highSeverityIssueCount: 99,
    publicApiChanged: true,
    securityFindingCount: 99,
  });

  assert.equal(assessment.score, 10);
  assert.equal(
    assessment.factors.find((factor) => factor.id === "SECURITY_FINDINGS")?.contribution,
    3,
  );
  assert.equal(
    assessment.factors.find((factor) => factor.id === "HIGH_SEVERITY_ISSUES")?.contribution,
    4,
  );
});

test("uses stable category boundaries", () => {
  assert.equal(categoryForRiskScore(1), "LOW");
  assert.equal(categoryForRiskScore(3), "LOW");
  assert.equal(categoryForRiskScore(4), "MEDIUM");
  assert.equal(categoryForRiskScore(6), "MEDIUM");
  assert.equal(categoryForRiskScore(7), "HIGH");
  assert.equal(categoryForRiskScore(8), "HIGH");
  assert.equal(categoryForRiskScore(9), "CRITICAL");
  assert.equal(categoryForRiskScore(10), "CRITICAL");
});
