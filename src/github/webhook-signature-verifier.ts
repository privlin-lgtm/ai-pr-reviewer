import { Webhooks } from "@octokit/webhooks";

import type { WebhookSignatureVerifier } from "./types.js";

export class OctokitWebhookSignatureVerifier implements WebhookSignatureVerifier {
  private readonly webhooks: Webhooks;

  constructor(secret: string) {
    if (secret.length === 0) {
      throw new Error("GITHUB_WEBHOOK_SECRET must not be empty.");
    }

    this.webhooks = new Webhooks({ secret });
  }

  async verify(body: string, signature: string | undefined): Promise<boolean> {
    return signature !== undefined && this.webhooks.verify(body, signature);
  }
}
