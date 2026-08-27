import {
  clearSessionCookie,
  loadGitHubAppIdentityConfig,
} from "../../../../src/auth/github-app-identity";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const config = loadGitHubAppIdentityConfig();
    return new Response(null, {
      headers: {
        "cache-control": "no-store",
        "set-cookie": clearSessionCookie(config, useSecureCookies(request)),
      },
      status: 204,
    });
  } catch {
    return new Response(null, { headers: { "cache-control": "no-store" }, status: 204 });
  }
}

function useSecureCookies(request: Request): boolean {
  return process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
}
