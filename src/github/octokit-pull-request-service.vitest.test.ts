import { describe, expect, it, vi } from "vitest";

import { OctokitPullRequestService } from "./octokit-pull-request-service.js";
import type { PullRequestTarget } from "./types.js";

const target: PullRequestTarget = {
  installationId: 123,
  owner: "octocat",
  pullNumber: 42,
  repository: "hello-world",
};

function createService(
  request: ReturnType<typeof vi.fn>,
  retryOptions: ConstructorParameters<typeof OctokitPullRequestService>[1] = {},
) {
  const app = {
    getInstallationOctokit: vi.fn().mockResolvedValue({ request }),
  };

  return {
    app,
    service: new OctokitPullRequestService(app as never, retryOptions),
  };
}

describe("OctokitPullRequestService.fetchDiff", () => {
  it("retrieves a unified diff through the installation Octokit client", async () => {
    const request = vi.fn().mockResolvedValue({ data: "diff --git a/a.ts b/a.ts\n" });
    const { app, service } = createService(request);

    await expect(service.fetchDiff(target)).resolves.toEqual({
      ...target,
      content: "diff --git a/a.ts b/a.ts\n",
    });
    expect(app.getInstallationOctokit).toHaveBeenCalledOnce();
    expect(app.getInstallationOctokit).toHaveBeenCalledWith(target.installationId);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner: target.owner,
        repo: target.repository,
        pull_number: target.pullNumber,
        headers: { accept: "application/vnd.github.v3.diff" },
      },
    );
  });

  it("propagates ordinary GitHub API failures without retrying", async () => {
    const failure = Object.assign(new Error("Not Found"), { status: 404 });
    const request = vi.fn().mockRejectedValue(failure);
    const delay = vi.fn(async () => undefined);
    const { service } = createService(request, { delay });

    await expect(service.fetchDiff(target)).rejects.toBe(failure);
    expect(request).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
  });

  it("retries a rate-limited diff request using GitHub's Retry-After value", async () => {
    const rateLimited = Object.assign(new Error("Too Many Requests"), {
      response: { headers: { "retry-after": "2" } },
      status: 429,
    });
    const request = vi
      .fn()
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce({ data: "diff --git a/a.ts b/a.ts\n" });
    const delay = vi.fn(async () => undefined);
    const { service } = createService(request, { delay });

    await expect(service.fetchDiff(target)).resolves.toMatchObject({
      content: "diff --git a/a.ts b/a.ts\n",
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledOnce();
    expect(delay).toHaveBeenCalledWith(2_000);
  });

  it("propagates GitHub's invalid pull request number response without retrying", async () => {
    const failure = Object.assign(new Error("Validation Failed"), { status: 422 });
    const request = vi.fn().mockRejectedValue(failure);
    const delay = vi.fn(async () => undefined);
    const invalidTarget = { ...target, pullNumber: 0 };
    const { service } = createService(request, { delay });

    await expect(service.fetchDiff(invalidTarget)).rejects.toBe(failure);
    expect(request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      expect.objectContaining({ pull_number: 0 }),
    );
    expect(request).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
  });
});
