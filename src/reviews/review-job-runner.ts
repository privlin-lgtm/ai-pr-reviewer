import { setTimeout as delay } from "node:timers/promises";

import {
  createStructuredLogger,
  errorLogFields,
  type StructuredLogger,
} from "../observability/structured-logger.js";
import { ReviewJobWorker } from "./review-job-worker.js";

export interface ReviewJobRunnerOptions {
  idleDelayMilliseconds?: number;
  logger?: StructuredLogger;
}

export class ReviewJobRunner {
  private readonly idleDelayMilliseconds: number;
  private readonly logger: StructuredLogger;
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
    this.logger =
      options.logger ??
      createStructuredLogger({ baseFields: { component: "review-job-runner" } });
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
        this.logger.error("review_job_worker_iteration_failed", errorLogFields(error));
      }
      await delay(this.idleDelayMilliseconds);
    }
  }
}
