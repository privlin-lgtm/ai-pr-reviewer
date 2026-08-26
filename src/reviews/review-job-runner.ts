import { setTimeout as delay } from "node:timers/promises";

import { ReviewJobWorker } from "./review-job-worker.js";

export interface ReviewJobRunnerOptions {
  idleDelayMilliseconds?: number;
}

export class ReviewJobRunner {
  private readonly idleDelayMilliseconds: number;
  private stopping = false;

  constructor(
    private readonly worker: ReviewJobWorker,
    options: ReviewJobRunnerOptions = {},
  ) {
    this.idleDelayMilliseconds = options.idleDelayMilliseconds ?? 1_000;
    if (
      !Number.isInteger(this.idleDelayMilliseconds) ||
      this.idleDelayMilliseconds < 1
    ) {
      throw new RangeError("idleDelayMilliseconds must be a positive integer.");
    }
  }

  stop(): void {
    this.stopping = true;
  }

  async run(): Promise<void> {
    while (!this.stopping) {
      try {
        if (await this.worker.runOnce()) {
          continue;
        }
      } catch (error) {
        console.error("Review job worker iteration failed.", error);
      }
      await delay(this.idleDelayMilliseconds);
    }
  }
}
