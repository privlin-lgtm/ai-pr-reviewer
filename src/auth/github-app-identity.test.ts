import assert from "node:assert/strict";
import test from "node:test";

import {
  createOAuthStateCookie,
  createSessionCookie,
  readGitHubAppSession,
  validateOAuthState,
  type GitHubAppIdentityConfig,
} from "./github-app-identity.js";

const config: GitHubAppIdentityConfig = {
  apiUrl: "https://api.github.com",
  authorizeUrl: "https://github.com/login/oauth/authorize",
  callbackUrl: "https://reviewer.example/api/auth/github/callback",
  clientId: "client-id",
  clientSecret: "client-secret",
  sessionCookieName: "reviewer-session",
  sessionSecret: "a-secure-test-session-secret-with-32-bytes",
  tokenUrl: "https://github.com/login/oauth/access_token",
};

test("accepts only signed OAuth state and signed session cookies", () => {
  const stateCookie = createOAuthStateCookie("csrf-state", config, true);
  assert.equal(validateOAuthState("csrf-state", stateCookie, config), true);
  assert.equal(validateOAuthState("other-state", stateCookie, config), false);
  assert.equal(
    validateOAuthState("csrf-state", stateCookie.replace("=", "=tampered"), config),
    false,
  );

  const sessionCookie = createSessionCookie("user-1", config, true);
  assert.deepEqual(readGitHubAppSession(sessionCookie, config), { userId: "user-1" });
  assert.equal(
    readGitHubAppSession(sessionCookie.replace("=", "=tampered"), config),
    null,
  );
});
