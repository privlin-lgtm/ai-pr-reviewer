import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import type { AIReviewEngine } from "../ai/ai-review-engine.js";
import type { AIReviewFinding, AIReviewResult } from "../ai/types.js";
import type {
  ChangedFile,
  GitHubPullRequestService,
  PullRequestMetadata,
  ReviewCommentInput,
} from "../github/types.js";
import { PullRequestRiskScorer } from "../risk/pull-request-risk-scorer.js";
import type { ClaimedReviewJob, ReviewJobHandler } from "./review-job-worker.js";
import {
  publicationMarker,
  type ReviewPublicationPayload,
} from "./publication-outbox.js";
import { redactMessage } from "../observability/structured-logger.js";

const DEFAULT_COMMENT_CONFIDENCE = 0.7;
const PROMPT_VERSION = "review-v1";

export interface PrismaReviewJobHandlerOptions {
  commentConfidence?: number;
  modelName: string;
}

export class PrismaReviewJobHandler implements ReviewJobHandler {
  private readonly commentConfidence: number;
  private readonly riskScorer = new PullRequestRiskScorer();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly pullRequests: GitHubPullRequestService,
    private readonly reviewEngine: AIReviewEngine,
    private readonly options: PrismaReviewJobHandlerOptions,
  ) {
    this.commentConfidence = options.commentConfidence ?? DEFAULT_COMMENT_CONFIDENCE;
    if (
      !Number.isFinite(this.commentConfidence) ||
      this.commentConfidence < 0 ||
      this.commentConfidence > 1
    ) {
      throw new RangeError("commentConfidence must be between 0 and 1.");
    }
  }

  async process(job: ClaimedReviewJob): Promise<"cancelled" | void> {
    const target = {
      installationId: Number(job.installationGithubId),
      owner: job.owner,
      pullNumber: job.pullRequestNumber,
      repository: job.repositoryName,
    };
    const [metadata, diff, files] = await Promise.all([
      this.pullRequests.fetchMetadata(target),
      this.pullRequests.fetchDiff(target),
      this.pullRequests.listChangedFiles(target),
    ]);

    if (metadata.headSha !== job.headSha) {
      return "cancelled";
    }

    const persisted = await this.persistPullRequest(metadata, job);
    if (persisted.review.status === "COMPLETED") {
      return;
    }

    try {
      const result = await this.reviewEngine.analyzeDiff({
        diff: diff.content,
        pullRequest: {
          baseRef: metadata.baseRef,
          headSha: metadata.headSha,
          number: metadata.pullNumber,
          repository: `${metadata.owner}/${metadata.repository}`,
        },
        ragContext: {
          branch: metadata.baseRef,
          repositoryId: persisted.repositoryId,
        },
      });
      const risk = this.riskScorer.score({
        authenticationChanged: files.some((file) => isAuthenticationPath(file.path)),
        databaseMigrationChanged: files.some((file) => isMigrationPath(file.path)),
        filesChanged: files.length,
        highSeverityIssueCount: result.findings.filter(isHighSeverity).length,
        publicApiChanged: files.some((file) => isPublicApiPath(file.path)),
        securityFindingCount: result.findings.filter(
          (finding) => finding.category === "SECURITY",
        ).length,
      });
      const candidates = toPublicationCandidates(
        result.findings,
        files,
        this.commentConfidence,
      );
      await this.persistAnalysisAndPublication({
        candidates,
        files,
        metadata,
        persisted,
        result,
        riskScore: risk.score,
        target,
      });
    } catch (error) {
      await this.prisma.review.update({
        data: {
          failureReason: redactMessage(
            error instanceof Error ? error.message : "Unknown review failure.",
            8_000,
          ),
          status: "FAILED",
        },
        where: { id: persisted.review.id },
      });
      throw error;
    }
  }

  private async persistPullRequest(metadata: PullRequestMetadata, job: ClaimedReviewJob) {
    return this.prisma.$transaction(async (transaction) => {
      const installation = await transaction.gitHubInstallation.upsert({
        create: {
          accountLogin: job.owner,
          accountType: "UNKNOWN",
          githubInstallationId: job.installationGithubId,
        },
        update: {},
        where: { githubInstallationId: job.installationGithubId },
      });
      const repository = await transaction.repository.upsert({
        create: {
          defaultBranch: metadata.baseRef,
          fullName: `${metadata.owner}/${metadata.repository}`,
          githubRepositoryId: job.repositoryGithubId,
          installationId: installation.id,
          name: metadata.repository,
          ownerLogin: metadata.owner,
        },
        update: {
          defaultBranch: metadata.baseRef,
          installationId: installation.id,
          isArchived: false,
          isEnabled: true,
          name: metadata.repository,
          ownerLogin: metadata.owner,
        },
        where: { githubRepositoryId: job.repositoryGithubId },
      });
      if (typeof installation.installedByUserId === "string") {
        await transaction.repositoryMembership.upsert({
          create: {
            repositoryId: repository.id,
            role: "ADMIN",
            userId: installation.installedByUserId,
          },
          update: { role: "ADMIN" },
          where: {
            userId_repositoryId: {
              repositoryId: repository.id,
              userId: installation.installedByUserId,
            },
          },
        });
      }
      if (repository.lastIndexedAt === null) {
        await transaction.repositoryIndexJob.upsert({
          create: {
            branch: repository.defaultBranch,
            installationGithubId: job.installationGithubId,
            owner: repository.ownerLogin,
            repositoryId: repository.id,
            repositoryName: repository.name,
          },
          update: {},
          where: {
            repositoryId_branch: {
              branch: repository.defaultBranch,
              repositoryId: repository.id,
            },
          },
        });
        await transaction.repository.updateMany({
          data: { indexStatus: "QUEUED" },
          where: { id: repository.id, indexStatus: "IDLE" },
        });
      }
      const pullRequest = await transaction.pullRequest.upsert({
        create: toPullRequestData(metadata, repository.id),
        update: toPullRequestData(metadata, repository.id),
        where: { githubPullRequestId: BigInt(metadata.githubPullRequestId) },
      });
      const startedAt = new Date();
      const existingReview = await transaction.review.findUnique({
        where: {
          pullRequestId_headSha: {
            headSha: metadata.headSha,
            pullRequestId: pullRequest.id,
          },
        },
      });
      if (existingReview?.status === "COMPLETED") {
        return { repositoryId: repository.id, review: existingReview, startedAt };
      }
      const review = await transaction.review.upsert({
        create: {
          headSha: metadata.headSha,
          modelName: this.options.modelName,
          promptVersion: PROMPT_VERSION,
          pullRequestId: pullRequest.id,
          startedAt,
          status: "PROCESSING",
          trigger: "WEBHOOK",
        },
        update: {
          failureReason: null,
          modelName: this.options.modelName,
          promptVersion: PROMPT_VERSION,
          startedAt,
          status: "PROCESSING",
        },
        where: {
          pullRequestId_headSha: {
            headSha: metadata.headSha,
            pullRequestId: pullRequest.id,
          },
        },
      });
      return { repositoryId: repository.id, review, startedAt };
    });
  }

  private async persistAnalysisAndPublication(input: {
    candidates: PublicationCandidate[];
    files: ChangedFile[];
    metadata: PullRequestMetadata;
    persisted: Awaited<ReturnType<PrismaReviewJobHandler["persistPullRequest"]>>;
    result: AIReviewResult;
    riskScore: number;
    target: {
      installationId: number;
      owner: string;
      pullNumber: number;
      repository: string;
    };
  }): Promise<void> {
    const {
      candidates,
      files,
      metadata,
      persisted,
      result,
      riskScore,
      target,
    } = input;
    const idempotencyKey = `review:${persisted.review.id}:github-review:v1`;
    const payload: ReviewPublicationPayload = {
      body: buildReviewBody(result, riskScore),
      comments: candidates.map((candidate) => candidate.comment),
      commitSha: metadata.headSha,
      event: "COMMENT",
      marker: publicationMarker(idempotencyKey),
      target,
      version: 1,
    };

    await this.prisma.$transaction(async (transaction) => {
      const persistedFindings = await Promise.all(
        result.findings.map((finding) =>
          transaction.finding.upsert({
            create: {
              category: finding.category,
              confidence: finding.confidence,
              endLine: finding.endLine,
              evidence: toFindingEvidence(finding, result),
              fingerprint: findingFingerprint(finding),
              path: finding.path,
              rationale: finding.rationale,
              reviewId: persisted.review.id,
              severity: finding.severity,
              side: finding.side,
              startLine: finding.startLine,
              status: "PENDING",
              suggestedFix: finding.recommendation,
              title: finding.title,
            },
            update: {
              confidence: finding.confidence,
              evidence: toFindingEvidence(finding, result),
              rationale: finding.rationale,
              suggestedFix: finding.recommendation,
              title: finding.title,
            },
            where: {
              reviewId_fingerprint: {
                fingerprint: findingFingerprint(finding),
                reviewId: persisted.review.id,
              },
            },
          }),
        ),
      );
      const findingIdsByFingerprint = new Map(
        persistedFindings.map((finding, index) => [
          findingFingerprint(result.findings[index]!),
          finding.id,
        ]),
      );
      const candidateIds = candidates.map((candidate) => {
        const id = findingIdsByFingerprint.get(candidate.fingerprint);
        if (id === undefined) {
          throw new Error("Persisted finding is missing its publication candidate.");
        }
        return id;
      });
      const allFindingIds = persistedFindings.map((finding) => finding.id);
      const outbox = await transaction.publicationOutbox.upsert({
        create: {
          idempotencyKey,
          payload: payload as unknown as Prisma.InputJsonValue,
          reviewId: persisted.review.id,
        },
        update: {},
        where: { reviewId: persisted.review.id },
      });

      if (candidateIds.length > 0) {
        await transaction.finding.updateMany({
          data: {
            publicationOutboxId: outbox.id,
            publishedAt: null,
            status: "PENDING",
          },
          where: { id: { in: candidateIds } },
        });
      }
      await transaction.finding.updateMany({
        data: {
          publicationOutboxId: null,
          publishedAt: null,
          status: "SUPPRESSED",
        },
        where: {
          ...(allFindingIds.length === 0 ? {} : { id: { notIn: candidateIds } }),
          reviewId: persisted.review.id,
        },
      });
      await transaction.review.update({
        data: {
          completedAt: new Date(),
          riskScore,
          status: "COMPLETED",
          summary: result.summary,
        },
        where: { id: persisted.review.id },
      });
      await transaction.reviewMetrics.upsert({
        create: {
          commentsPublished: 0,
          durationMs: Date.now() - persisted.startedAt.valueOf(),
          filesAnalyzed: files.filter((file) => file.patch !== null).length,
          filesChanged: files.length,
          modelCallCount: 1,
          reviewId: persisted.review.id,
        },
        update: {
          commentsPublished: 0,
          durationMs: Date.now() - persisted.startedAt.valueOf(),
          filesAnalyzed: files.filter((file) => file.patch !== null).length,
          filesChanged: files.length,
          modelCallCount: 1,
        },
        where: { reviewId: persisted.review.id },
      });
    });
  }
}

function toPullRequestData(metadata: PullRequestMetadata, repositoryId: string) {
  return {
    authorGithubLogin: metadata.authorGithubLogin,
    authorGithubUserId:
      metadata.authorGithubUserId === null ? null : BigInt(metadata.authorGithubUserId),
    baseBranch: metadata.baseRef,
    baseSha: metadata.baseSha,
    body: metadata.body,
    closedAt: metadata.closedAt,
    githubCreatedAt: metadata.createdAt,
    githubPullRequestId: BigInt(metadata.githubPullRequestId),
    githubUpdatedAt: metadata.updatedAt,
    headBranch: metadata.headRef,
    headSha: metadata.headSha,
    isDraft: metadata.isDraft,
    mergedAt: metadata.mergedAt,
    number: metadata.pullNumber,
    repositoryId,
    state: metadata.state,
    title: metadata.title,
  };
}

function findingFingerprint(finding: AIReviewFinding): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        category: finding.category,
        endLine: finding.endLine,
        path: finding.path,
        severity: finding.severity,
        side: finding.side,
        startLine: finding.startLine,
        title: finding.title,
      }),
    )
    .digest("hex");
}

function isHighSeverity(finding: AIReviewFinding): boolean {
  return finding.severity === "CRITICAL" || finding.severity === "HIGH";
}

function isAuthenticationPath(path: string): boolean {
  return /(^|\/)(auth|authentication|authorization|permissions?|roles?|sessions?)(\/|\.|$)/i.test(path);
}

function isMigrationPath(path: string): boolean {
  return /(^|\/)(migrations?|prisma)(\/|\.|$)|schema\.prisma$/i.test(path);
}

function isPublicApiPath(path: string): boolean {
  return /(^|\/)(api|openapi|graphql)(\/|\.|$)|\.(proto|graphql)$/i.test(path);
}

interface PublicationCandidate {
  comment: ReviewCommentInput;
  fingerprint: string;
}

function toPublicationCandidates(
  findings: AIReviewFinding[],
  files: ChangedFile[],
  confidence: number,
): PublicationCandidate[] {
  const changedLines = new Map(
    files.map((file) => [file.path, changedLinesForFile(file)]),
  );

  return findings.flatMap((finding) => {
    if (
      finding.startLine === null ||
      finding.endLine === null ||
      finding.side === null ||
      finding.confidence < confidence
    ) {
      return [];
    }
    const lines = changedLines.get(finding.path);
    if (lines === undefined || !lines[finding.side].has(finding.endLine)) {
      return [];
    }

    return [{
      comment: {
        body: `**${finding.severity} — ${finding.title}**\n\n${finding.rationale}\n\nSuggested fix: ${finding.recommendation}`,
        line: finding.endLine,
        path: finding.path,
        side: finding.side,
        ...(finding.startLine < finding.endLine
          ? { startLine: finding.startLine, startSide: finding.side }
          : {}),
      },
      fingerprint: findingFingerprint(finding),
    }];
  });
}

function toFindingEvidence(finding: AIReviewFinding, result: AIReviewResult): Prisma.InputJsonValue {
  const references = finding.standardViolation?.references ?? [];
  const sources = result.sourceProvenance?.filter((source) =>
    references.includes(source.reference),
  ) ?? [];
  return {
    source: "openai",
    ...(finding.standardViolation === null
      ? {}
      : { standardViolation: finding.standardViolation }),
    ...(sources.length === 0 ? {} : { citedStandards: sources }),
  } as unknown as Prisma.InputJsonValue;
}

function changedLinesForFile(file: ChangedFile): Record<"LEFT" | "RIGHT", Set<number>> {
  const lines = { LEFT: new Set<number>(), RIGHT: new Set<number>() };
  if (file.patch === null) {
    return lines;
  }

  let oldLine = 0;
  let newLine = 0;
  for (const line of file.patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk !== null) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      lines.RIGHT.add(newLine++);
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      lines.LEFT.add(oldLine++);
    } else if (line.startsWith(" ") || line.length === 0) {
      oldLine += 1;
      newLine += 1;
    }
  }
  return lines;
}

function buildReviewBody(result: AIReviewResult, riskScore: number): string {
  return [
    `## AI review`,
    "",
    `Risk score: **${riskScore}/10**`,
    "",
    result.summary,
    "",
    `${result.findings.length} finding(s) analyzed; inline comments include only high-confidence findings on changed lines.`,
  ].join("\n");
}
