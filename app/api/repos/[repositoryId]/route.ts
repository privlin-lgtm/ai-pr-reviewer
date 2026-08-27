import {
  authenticateGitHubAppRequest,
  authenticationResponse,
} from "../../../../src/auth/request-authentication";

export const runtime = "nodejs";

export async function PATCH(
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
  const body = await request.json().catch(() => null);
  if (
    typeof body !== "object" ||
    body === null ||
    !("enabled" in body) ||
    typeof body.enabled !== "boolean"
  ) {
    return Response.json(
      { error: "Request body must contain a boolean enabled field." },
      { headers: { "cache-control": "no-store" }, status: 400 },
    );
  }
  const { repositoryId } = await context.params;
  const { prisma } = await import("../../../../src/lib/prisma");
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
  const repository = await prisma.repository.update({
    data: { isEnabled: body.enabled },
    select: { id: true, isEnabled: true },
    where: { id: repositoryId },
  });
  return Response.json(
    { repository },
    { headers: { "cache-control": "no-store" } },
  );
}
