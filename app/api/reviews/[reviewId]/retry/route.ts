import {
  authenticateGitHubAppRequest,
  authenticationResponse,
} from "../../../../../src/auth/request-authentication";
import {
  ReviewNotRetryableError,
  ReviewRetryService,
} from "../../../../../src/reviews/review-retry-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ reviewId: string }> },
): Promise<Response> {
  const authentication = authenticateGitHubAppRequest(request);
  const response = authenticationResponse(authentication);
  if (response !== null) {
    return response;
  }
  if (authentication.status !== "authenticated") {
    return Response.json(
      { error: "Authentication is required." },
      { headers: { "cache-control": "no-store" }, status: 401 },
    );
  }
  const { reviewId } = await context.params;
  const { prisma } = await import("../../../../../src/lib/prisma");
  const permittedReview = await prisma.review.findFirst({
    select: { id: true },
    where: {
      id: reviewId,
      pullRequest: {
        repository: {
          memberships: {
            some: {
              role: { in: ["ADMIN", "OWNER"] },
              userId: authentication.userId,
            },
          },
        },
      },
    },
  });
  if (permittedReview === null) {
    return Response.json(
      { error: "Review was not found." },
      { headers: { "cache-control": "no-store" }, status: 404 },
    );
  }
  try {
    const result = await new ReviewRetryService(prisma).retry(reviewId);
    if (result === null) {
      return Response.json(
        { error: "Review was not found." },
        { headers: { "cache-control": "no-store" }, status: 404 },
      );
    }
    return Response.json(result, { headers: { "cache-control": "no-store" }, status: 202 });
  } catch (error) {
    if (error instanceof ReviewNotRetryableError) {
      return Response.json(
        { error: "Only failed reviews can be retried." },
        { headers: { "cache-control": "no-store" }, status: 409 },
      );
    }
    return Response.json(
      { error: "Review retry could not be queued." },
      { headers: { "cache-control": "no-store" }, status: 503 },
    );
  }
}
