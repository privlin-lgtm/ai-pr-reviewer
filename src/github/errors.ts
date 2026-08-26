export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super("GitHub webhook signature verification failed.");
    this.name = "InvalidWebhookSignatureError";
  }
}

export class InvalidWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWebhookPayloadError";
  }
}

export class ChangedFileLimitExceededError extends Error {
  constructor(maximumFiles: number) {
    super(`Pull request exceeds the configured ${maximumFiles} changed-file limit.`);
    this.name = "ChangedFileLimitExceededError";
  }
}
