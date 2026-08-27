import {
  authenticateGitHubAppRequest,
  authenticationResponse,
} from "../../../../../src/auth/request-authentication";
import { RepositoryIndexQueue } from "../../../../../src/rag/repository-index-queue";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ repositoryId: string }> },
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
  const { repositoryId } = await context.params;
  const { prisma } = await import("../../../../../src/lib/prisma");
  const membership = await prisma.repositoryMembership.findFirst({
    select: { id: true },
    where: {
      repositoryId,
      role: { in: ["ADMIN", "OWNER"] },
      userId: authentication.userId,
    },
  });
  if (membership === null) {
    return Response.json(
      { error: "Repository was not found." },
      { headers: { "cache-control": "no-store" }, status: 404 },
    );
  }
  const body = await request.json().catch(() => ({}));
  if (
    typeof body !== "object" ||
    body === null ||
    ("force" in body && typeof body.force !== "boolean")
  ) {
    return Response.json(
      { error: "Request body force field must be a boolean." },
      { headers: { "cache-control": "no-store" }, status: 400 },
    );
  }
  const force = "force" in body && body.force === true;
  try {
    const result = await new RepositoryIndexQueue(prisma).enqueue({ force, repositoryId });
    return Response.json(result, { headers: { "cache-control": "no-store" }, status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "Repository indexing is disabled.") {
      return Response.json(
        { error: "Repository indexing is disabled." },
        { headers: { "cache-control": "no-store" }, status: 409 },
      );
    }
    return Response.json(
      { error: "Repository indexing could not be queued." },
      { headers: { "cache-control": "no-store" }, status: 503 },
    );
  }
}
