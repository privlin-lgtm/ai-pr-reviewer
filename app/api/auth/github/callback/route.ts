import {
  clearOAuthStateCookie,
  createSessionCookie,
  GitHubAppIdentityService,
  loadGitHubAppIdentityConfig,
  validateOAuthState,
} from "../../../../../src/auth/github-app-identity";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const returnUrl = new URL("/", request.url);
  let config;
  try {
    config = loadGitHubAppIdentityConfig();
  } catch {
    return Response.json(
      { error: "GitHub sign-in is not configured." },
      { headers: { "cache-control": "no-store" }, status: 503 },
    );
  }

  const secure = useSecureCookies(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (
    !validateOAuthState(url.searchParams.get("state"), request.headers.get("cookie"), config) ||
    code === null
  ) {
    returnUrl.searchParams.set("auth", "invalid");
    return redirect(returnUrl, clearOAuthStateCookie(secure));
  }

  try {
    const { prisma } = await import("../../../../../src/lib/prisma");
    const user = await new GitHubAppIdentityService(prisma, config).completeAuthorization(code);
    return redirect(
      returnUrl,
      [
        createSessionCookie(user.id, config, secure),
        clearOAuthStateCookie(secure),
      ],
    );
  } catch {
    returnUrl.searchParams.set("auth", "failed");
    return redirect(returnUrl, clearOAuthStateCookie(secure));
  }
}

function redirect(url: URL, cookies: string | string[]): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    location: url.toString(),
  });
  for (const cookie of Array.isArray(cookies) ? cookies : [cookies]) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, {
    headers,
    status: 303,
  });
}

function useSecureCookies(request: Request): boolean {
  return process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
}
