import {
  createGitHubAuthorization,
  createOAuthStateCookie,
  loadGitHubAppIdentityConfig,
} from "../../../../src/auth/github-app-identity";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const config = loadGitHubAppIdentityConfig();
    const authorization = createGitHubAuthorization(config);
    return new Response(null, {
      headers: {
        "cache-control": "no-store",
        location: authorization.url,
        "set-cookie": createOAuthStateCookie(
          authorization.state,
          config,
          useSecureCookies(request),
        ),
      },
      status: 302,
    });
  } catch {
    return Response.json(
      { error: "GitHub sign-in is not configured." },
      { headers: { "cache-control": "no-store" }, status: 503 },
    );
  }
}

function useSecureCookies(request: Request): boolean {
  return process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
}
