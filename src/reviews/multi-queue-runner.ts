import { setTimeout as delay } from "node:timers/promises";

import {
  createStructuredLogger,
  errorLogFields,
  type StructuredLogger,
} from "../observability/structured-logger.js";

export interface RunnableWorker {
  runOnce(): Promise<boolean>;
}

export interface MultiQueueRunnerOptions {
  idleDelayMilliseconds?: number;
  logger?: StructuredLogger;
  onError?: () => void;
  onIteration?: (didWork: boolean) => void;
}

export class MultiQueueRunner {
  private readonly idleDelayMilliseconds: number;
  private readonly logger: StructuredLogger;
  private readonly onError?: () => void;
  private readonly onIteration?: (didWork: boolean) => void;
  private stopping = false;

  constructor(
    private readonly workers: RunnableWorker[],
    options: MultiQueueRunnerOptions = {},
  ) {
    if (workers.length === 0) {
      throw new RangeError("At least one worker is required.");
    }
    this.idleDelayMilliseconds = options.idleDelayMilliseconds ?? 1_000;
    if (
      !Number.isInteger(this.idleDelayMilliseconds) ||
      this.idleDelayMilliseconds < 1
    ) {
      throw new RangeError("idleDelayMilliseconds must be a positive integer.");
    }
    this.logger =
      options.logger ?? createStructuredLogger({ baseFields: { component: "multi-queue-runner" } });
    this.onError = options.onError;
    this.onIteration = options.onIteration;
  }

  stop(): void {
    this.stopping = true;
  }

  async run(): Promise<void> {
    while (!this.stopping) {
      let didWork = false;
      for (const worker of this.workers) {
        if (this.stopping) {
          break;
        }
        try {
          didWork = (await worker.runOnce()) || didWork;
        } catch (error) {
          this.onError?.();
          this.logger.error("worker_iteration_failed", errorLogFields(error));
        }
      }
      this.onIteration?.(didWork);
      if (!didWork && !this.stopping) {
        await delay(this.idleDelayMilliseconds);
      }
    }
  }
}
