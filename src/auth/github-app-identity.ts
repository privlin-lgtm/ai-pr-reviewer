import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { PrismaClient } from "@prisma/client";

export interface GitHubAppIdentityConfig {
  apiUrl: string;
  authorizeUrl: string;
  callbackUrl: string;
  clientId: string;
  clientSecret: string;
  sessionCookieName: string;
  sessionSecret: string;
  tokenUrl: string;
}

export interface GitHubIdentityUser {
  avatarUrl: string | null;
  displayName: string | null;
  email: string | null;
  githubLogin: string;
  githubUserId: bigint;
  id: string;
}

interface GitHubOAuthProfile {
  avatarUrl: string | null;
  email: string | null;
  id: number;
  login: string;
  name: string | null;
}

interface SessionPayload {
  expiresAt: number;
  userId: string;
}

interface StatePayload {
  expiresAt: number;
  state: string;
}

const DEFAULT_COOKIE_NAME = "ai_pr_reviewer_session";
const STATE_COOKIE_NAME = "ai_pr_reviewer_oauth_state";
const STATE_TTL_MILLISECONDS = 10 * 60_000;
const SESSION_TTL_MILLISECONDS = 7 * 24 * 60 * 60_000;

export function loadGitHubAppIdentityConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GitHubAppIdentityConfig {
  return {
    apiUrl: environment.GITHUB_API_URL?.trim() || "https://api.github.com",
    authorizeUrl:
      environment.GITHUB_OAUTH_AUTHORIZE_URL?.trim() ||
      "https://github.com/login/oauth/authorize",
    callbackUrl: readRequired(environment, "GITHUB_APP_CALLBACK_URL"),
    clientId: readRequired(environment, "GITHUB_APP_CLIENT_ID"),
    clientSecret: readRequired(environment, "GITHUB_APP_CLIENT_SECRET"),
    sessionCookieName:
      environment.GITHUB_APP_SESSION_COOKIE_NAME?.trim() || DEFAULT_COOKIE_NAME,
    sessionSecret: readSessionSecret(environment),
    tokenUrl:
      environment.GITHUB_OAUTH_TOKEN_URL?.trim() ||
      "https://github.com/login/oauth/access_token",
  };
}

export function tryLoadGitHubAppIdentityConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GitHubAppIdentityConfig | null {
  const required = [
    environment.GITHUB_APP_CALLBACK_URL,
    environment.GITHUB_APP_CLIENT_ID,
    environment.GITHUB_APP_CLIENT_SECRET,
    environment.APP_SESSION_SECRET,
  ];
  return required.every((value) => value !== undefined && value.trim().length > 0)
    ? loadGitHubAppIdentityConfig(environment)
    : null;
}

export function createGitHubAuthorization(
  config: GitHubAppIdentityConfig,
): { state: string; url: string } {
  const state = randomBytes(32).toString("base64url");
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return { state, url: url.toString() };
}

export function createOAuthStateCookie(
  state: string,
  config: GitHubAppIdentityConfig,
  secure: boolean,
): string {
  return serializeCookie(
    STATE_COOKIE_NAME,
    signPayload(
      { expiresAt: Date.now() + STATE_TTL_MILLISECONDS, state },
      config.sessionSecret,
    ),
    { httpOnly: true, maxAgeSeconds: STATE_TTL_MILLISECONDS / 1_000, secure },
  );
}

export function validateOAuthState(
  state: string | null,
  cookieHeader: string | null,
  config: GitHubAppIdentityConfig,
): boolean {
  if (state === null || state.length === 0) {
    return false;
  }
  const signedState = readCookie(cookieHeader, STATE_COOKIE_NAME);
  if (signedState === undefined) {
    return false;
  }
  const payload = verifyPayload<StatePayload>(signedState, config.sessionSecret);
  return (
    payload !== null &&
    payload.expiresAt >= Date.now() &&
    timingSafeStringEqual(payload.state, state)
  );
}

export function createSessionCookie(
  userId: string,
  config: GitHubAppIdentityConfig,
  secure: boolean,
): string {
  return serializeCookie(
    config.sessionCookieName,
    signPayload(
      { expiresAt: Date.now() + SESSION_TTL_MILLISECONDS, userId },
      config.sessionSecret,
    ),
    { httpOnly: true, maxAgeSeconds: SESSION_TTL_MILLISECONDS / 1_000, secure },
  );
}

export function clearOAuthStateCookie(secure: boolean): string {
  return serializeCookie(STATE_COOKIE_NAME, "", {
    httpOnly: true,
    maxAgeSeconds: 0,
    secure,
  });
}

export function clearSessionCookie(
  config: GitHubAppIdentityConfig,
  secure: boolean,
): string {
  return serializeCookie(config.sessionCookieName, "", {
    httpOnly: true,
    maxAgeSeconds: 0,
    secure,
  });
}

export function readGitHubAppSession(
  cookieHeader: string | null,
  config: GitHubAppIdentityConfig,
): { userId: string } | null {
  const signedSession = readCookie(cookieHeader, config.sessionCookieName);
  return readGitHubAppSessionValue(signedSession ?? null, config);
}

export function readGitHubAppSessionValue(
  signedSession: string | null,
  config: GitHubAppIdentityConfig,
): { userId: string } | null {
  if (signedSession === null) {
    return null;
  }
  const payload = verifyPayload<SessionPayload>(signedSession, config.sessionSecret);
  if (payload === null || payload.expiresAt < Date.now() || payload.userId.length === 0) {
    return null;
  }
  return { userId: payload.userId };
}

export class GitHubAppIdentityService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: GitHubAppIdentityConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  async completeAuthorization(code: string): Promise<GitHubIdentityUser> {
    const accessToken = await this.exchangeCode(code);
    const profile = await this.fetchProfile(accessToken);
    const user = await this.prisma.user.upsert({
      create: {
        avatarUrl: profile.avatarUrl,
        displayName: profile.name,
        email: profile.email,
        githubLogin: profile.login,
        githubUserId: BigInt(profile.id),
      },
      update: {
        avatarUrl: profile.avatarUrl,
        displayName: profile.name,
        email: profile.email,
        githubLogin: profile.login,
      },
      where: { githubUserId: BigInt(profile.id) },
    });
    try {
      await synchronizeAccessibleMemberships(
        this.prisma,
        user,
        accessToken,
        this.config.apiUrl,
        this.request,
      );
    } catch {
      // Authentication remains valid; absent GitHub membership data leaves the dashboard empty.
    }
    return user;
  }

  private async exchangeCode(code: string): Promise<string> {
    if (code.trim().length === 0) {
      throw new GitHubIdentityError("GitHub authorization code is missing.");
    }
    const response = await this.request(this.config.tokenUrl, {
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.callbackUrl,
      }),
      headers: { Accept: "application/json" },
      method: "POST",
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(data) || typeof data["access_token"] !== "string") {
      throw new GitHubIdentityError("GitHub could not exchange the authorization code.");
    }
    return data["access_token"];
  }

  private async fetchProfile(accessToken: string): Promise<GitHubOAuthProfile> {
    const response = await this.request(`${this.config.apiUrl}/user`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(data)) {
      throw new GitHubIdentityError("GitHub could not identify the signed-in user.");
    }
    if (
      typeof data["id"] !== "number" ||
      !Number.isSafeInteger(data["id"]) ||
      typeof data["login"] !== "string" ||
      data["login"].length === 0
    ) {
      throw new GitHubIdentityError("GitHub returned an invalid user identity.");
    }
    return {
      avatarUrl: readOptionalString(data, "avatar_url"),
      email: readOptionalString(data, "email"),
      id: data["id"],
      login: data["login"],
      name: readOptionalString(data, "name"),
    };
  }
}

export class GitHubIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubIdentityError";
  }
}

export async function synchronizeAccessibleMemberships(
  prisma: PrismaClient,
  user: GitHubIdentityUser,
  accessToken: string,
  apiUrl = "https://api.github.com",
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request(`${apiUrl}/user/installations`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(data) || !Array.isArray(data["installations"])) {
    return;
  }
  const installations = data["installations"];

  await prisma.$transaction(async (transaction) => {
    for (const installation of installations) {
      const parsed = parseAccessibleInstallation(installation);
      if (parsed === null) {
        continue;
      }
      const personalInstallation =
        parsed.accountLogin === user.githubLogin &&
        parsed.accountType.toLowerCase() === "user";
      const persistedInstallation = await transaction.gitHubInstallation.upsert({
        create: {
          accountLogin: parsed.accountLogin,
          accountType: parsed.accountType,
          githubInstallationId: BigInt(parsed.id),
          ...(personalInstallation ? { installedByUserId: user.id } : {}),
        },
        update: {
          accountLogin: parsed.accountLogin,
          accountType: parsed.accountType,
          ...(personalInstallation ? { installedByUserId: user.id } : {}),
        },
        where: { githubInstallationId: BigInt(parsed.id) },
      });
      const repositories = await transaction.repository.findMany({
        select: { id: true },
        where: { installationId: persistedInstallation.id },
      });
      for (const repository of repositories) {
        await transaction.repositoryMembership.upsert({
          create: {
            repositoryId: repository.id,
            role: personalInstallation ? "ADMIN" : "VIEWER",
            userId: user.id,
          },
          update: personalInstallation ? { role: "ADMIN" } : {},
          where: {
            userId_repositoryId: {
              repositoryId: repository.id,
              userId: user.id,
            },
          },
        });
      }
    }
  });
}

function parseAccessibleInstallation(
  value: unknown,
): { accountLogin: string; accountType: string; id: number } | null {
  if (!isRecord(value) || !isRecord(value["account"])) {
    return null;
  }
  const account = value["account"];
  if (
    typeof value["id"] !== "number" ||
    !Number.isSafeInteger(value["id"]) ||
    typeof account["login"] !== "string" ||
    typeof account["type"] !== "string"
  ) {
    return null;
  }
  return {
    accountLogin: account["login"],
    accountType: account["type"],
    id: value["id"],
  };
}

function signPayload(payload: SessionPayload | StatePayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifyPayload<T>(value: string, secret: string): T | null {
  const parts = value.split(".");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    return null;
  }
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return isRecord(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly: boolean; maxAgeSeconds: number; secure: boolean },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${Math.floor(options.maxAgeSeconds)}`,
    "SameSite=Lax",
    ...(options.httpOnly ? ["HttpOnly"] : []),
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (cookieHeader === null) {
    return undefined;
  }
  for (const entry of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = entry.trim().split("=");
    if (rawName === name) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function readRequired(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readSessionSecret(environment: NodeJS.ProcessEnv): string {
  const secret = readRequired(environment, "APP_SESSION_SECRET");
  if (Buffer.byteLength(secret) < 32) {
    throw new Error("APP_SESSION_SECRET must be at least 32 bytes.");
  }
  return secret;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
