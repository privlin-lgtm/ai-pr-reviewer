import { App } from "@octokit/app";

import type { GitHubAppConfig } from "./config.js";
import { OctokitPullRequestService } from "./octokit-pull-request-service.js";
import type { RetryOptions } from "./retry.js";
import { OctokitWebhookSignatureVerifier } from "./webhook-signature-verifier.js";

export function createGitHubAppServices(
  config: GitHubAppConfig,
  retryOptions?: RetryOptions,
) {
  const app = new App({
    appId: config.appId,
    privateKey: config.privateKey,
  });

  return {
    app,
    pullRequests: new OctokitPullRequestService(app, retryOptions),
    signatureVerifier: new OctokitWebhookSignatureVerifier(config.webhookSecret),
  };
}
