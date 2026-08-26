import { z } from "zod";

export const FindingCategorySchema = z.enum([
  "BUG",
  "SECURITY",
  "PERFORMANCE",
  "MAINTAINABILITY",
]);

export const FindingSeveritySchema = z.enum([
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
]);

const DiffSideSchema = z.enum(["LEFT", "RIGHT"]).nullable();
const LineNumberSchema = z.number().int().positive().nullable();

export const AIReviewFindingSchema = z
  .object({
    category: FindingCategorySchema,
    confidence: z.number().min(0).max(1),
    endLine: LineNumberSchema,
    path: z.string().min(1),
    rationale: z.string().min(1),
    recommendation: z.string().min(1),
    severity: FindingSeveritySchema,
    side: DiffSideSchema,
    startLine: LineNumberSchema,
    title: z.string().min(1),
  })
  .strict()
  .superRefine((finding, context) => {
    const hasStartLine = finding.startLine !== null;
    const hasEndLine = finding.endLine !== null;

    if (hasStartLine !== hasEndLine) {
      context.addIssue({
        code: "custom",
        message: "startLine and endLine must both be set or both be null.",
      });
    }

    if (hasStartLine && finding.endLine !== null && finding.startLine !== null) {
      if (finding.endLine < finding.startLine) {
        context.addIssue({
          code: "custom",
          message: "endLine must not precede startLine.",
        });
      }
    }

    if (hasStartLine !== (finding.side !== null)) {
      context.addIssue({
        code: "custom",
        message: "side must be set exactly when line coordinates are set.",
      });
    }
  });

export const AIReviewRecommendationSchema = z
  .object({
    detail: z.string().min(1),
    priority: FindingSeveritySchema,
    relatedPaths: z.array(z.string().min(1)).max(20),
    title: z.string().min(1),
  })
  .strict();

export const AIReviewResponseSchema = z
  .object({
    findings: z.array(AIReviewFindingSchema).max(100),
    recommendations: z.array(AIReviewRecommendationSchema).max(20),
    summary: z.string().min(1),
  })
  .strict();

export type FindingCategory = z.infer<typeof FindingCategorySchema>;
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type AIReviewFinding = z.infer<typeof AIReviewFindingSchema>;
export type AIReviewRecommendation = z.infer<typeof AIReviewRecommendationSchema>;
export type AIReviewResult = z.infer<typeof AIReviewResponseSchema>;

export interface AnalyzeDiffRequest {
  diff: string;
  pullRequest: {
    baseRef: string;
    headSha: string;
    number: number;
    repository: string;
  };
  repositoryStandards?: string[];
}

export interface StructuredReviewModelRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface StructuredReviewModel {
  complete(request: StructuredReviewModelRequest): Promise<string>;
}

export interface PrismaFindingDraft {
  category: FindingCategory;
  confidence: number;
  endLine: number | null;
  evidence: {
    source: "openai";
  };
  path: string;
  rationale: string;
  severity: FindingSeverity;
  side: "LEFT" | "RIGHT" | null;
  startLine: number | null;
  status: "PENDING";
  suggestedFix: string;
  title: string;
}

export function toPrismaFindingDraft(finding: AIReviewFinding): PrismaFindingDraft {
  return {
    category: finding.category,
    confidence: finding.confidence,
    endLine: finding.endLine,
    evidence: { source: "openai" },
    path: finding.path,
    rationale: finding.rationale,
    severity: finding.severity,
    side: finding.side,
    startLine: finding.startLine,
    status: "PENDING",
    suggestedFix: finding.recommendation,
    title: finding.title,
  };
}
