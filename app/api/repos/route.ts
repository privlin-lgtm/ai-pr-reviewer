import {
  authenticateGitHubAppRequest,
  authenticationResponse,
} from "../../../src/auth/request-authentication";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
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

  const { prisma } = await import("../../../src/lib/prisma");
  const memberships = await prisma.repositoryMembership.findMany({
    orderBy: { repository: { fullName: "asc" } },
    select: {
      role: true,
      repository: {
        select: {
          fullName: true,
          id: true,
          indexStatus: true,
          isEnabled: true,
          lastIndexedAt: true,
        },
      },
    },
    where: { userId: authentication.userId },
  });
  return Response.json(
    {
      repositories: memberships.map((membership) => ({
        ...membership.repository,
        role: membership.role,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
