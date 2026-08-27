import {
  authenticateGitHubAppRequest,
  authenticationResponse,
} from "../../../../src/auth/request-authentication";

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
  const { prisma } = await import("../../../../src/lib/prisma");
  const user = await prisma.user.findUnique({
    select: {
      avatarUrl: true,
      displayName: true,
      githubLogin: true,
    },
    where: { id: authentication.userId },
  });
  if (user === null) {
    return Response.json(
      { error: "Authentication is required." },
      { headers: { "cache-control": "no-store" }, status: 401 },
    );
  }
  return Response.json(
    { authenticated: true, user },
    { headers: { "cache-control": "no-store" } },
  );
}
