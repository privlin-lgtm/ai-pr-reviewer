import {
  readGitHubAppSession,
  tryLoadGitHubAppIdentityConfig,
  type GitHubAppIdentityConfig,
} from "./github-app-identity";

export type RequestAuthentication =
  | { status: "unconfigured" }
  | { status: "unauthenticated" }
  | { config: GitHubAppIdentityConfig; status: "authenticated"; userId: string };

export function authenticateGitHubAppRequest(request: Request): RequestAuthentication {
  const config = tryLoadGitHubAppIdentityConfig();
  if (config === null) {
    return { status: "unconfigured" };
  }
  const session = readGitHubAppSession(request.headers.get("cookie"), config);
  return session === null
    ? { status: "unauthenticated" }
    : { config, status: "authenticated", userId: session.userId };
}

export function authenticationResponse(
  authentication: RequestAuthentication,
): Response | null {
  if (authentication.status === "unconfigured") {
    return Response.json(
      { error: "Dashboard authentication is not configured." },
      { headers: { "cache-control": "no-store" }, status: 503 },
    );
  }
  if (authentication.status === "unauthenticated") {
    return Response.json(
      { error: "Authentication is required." },
      { headers: { "cache-control": "no-store" }, status: 401 },
    );
  }
  return null;
}
