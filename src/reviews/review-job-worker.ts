import {
  createStructuredLogger,
  errorLogFields,
  type StructuredLogger,
} from "../observability/structured-logger.js";
import { classifyJobFailure, type ClassifiedJobFailure } from "./job-failure.js";

export interface ClaimedReviewJob {
  attempts: number;
  headSha: string;
  id: string;
  installationGithubId: bigint;
  owner: string;
  pullRequestNumber: number;
  repositoryGithubId: bigint;
  repositoryName: string;
}

export interface ReviewJobStore {
  cancel(jobId: string, workerId: string): Promise<boolean>;
  claimNext(workerId: string): Promise<ClaimedReviewJob | null>;
  complete(jobId: string, workerId: string): Promise<boolean>;
  fail(
    jobId: string,
    workerId: string,
    attempt: number,
    failure: ClassifiedJobFailure,
  ): Promise<boolean>;
  heartbeat(jobId: string, workerId: string): Promise<boolean>;
}

export interface ReviewJobHandler {
  process(job: ClaimedReviewJob): Promise<"cancelled" | void>;
}

export interface ReviewJobWorkerOptions {
  heartbeatIntervalMilliseconds?: number;
  logger?: StructuredLogger;
}

export class ReviewJobWorker {
  private readonly heartbeatIntervalMilliseconds: number;
  private readonly logger: StructuredLogger;

  constructor(
    private readonly store: ReviewJobStore,
    private readonly handler: ReviewJobHandler,
    private readonly workerId: string,
    options: ReviewJobWorkerOptions = {},
  ) {
    this.heartbeatIntervalMilliseconds =
      options.heartbeatIntervalMilliseconds ?? 15_000;
    if (
      !Number.isInteger(this.heartbeatIntervalMilliseconds) ||
      this.heartbeatIntervalMilliseconds < 1
    ) {
      throw new RangeError("heartbeatIntervalMilliseconds must be a positive integer.");
    }
    this.logger =
      options.logger ??
      createStructuredLogger({ baseFields: { component: "review-job-worker", workerId } });
  }

  async runOnce(): Promise<boolean> {
    const job = await this.store.claimNext(this.workerId);
    if (job === null) {
      return false;
    }

    let leaseLost = false;
    let heartbeatRunning = false;
    const heartbeat = async () => {
      if (heartbeatRunning || leaseLost) {
        return;
      }
      heartbeatRunning = true;
      try {
        if (!(await this.store.heartbeat(job.id, this.workerId))) {
          leaseLost = true;
          this.logger.warn("review_job_lease_lost", { jobId: job.id });
        }
      } catch (error) {
        this.logger.warn("review_job_heartbeat_failed", {
          jobId: job.id,
          ...errorLogFields(error),
        });
      } finally {
        heartbeatRunning = false;
      }
    };
    const timer = setInterval(() => {
      void heartbeat();
    }, this.heartbeatIntervalMilliseconds);
    timer.unref?.();

    try {
      const result = await this.handler.process(job);
      await heartbeat();
      if (!leaseLost) {
        const transitioned =
          result === "cancelled"
            ? await this.store.cancel(job.id, this.workerId)
            : await this.store.complete(job.id, this.workerId);
        if (!transitioned) {
          this.logger.warn("review_job_transition_lost_lease", {
            jobId: job.id,
            transition: result === "cancelled" ? "cancel" : "complete",
          });
        }
      }
    } catch (error) {
      if (!leaseLost) {
        const failure = classifyJobFailure(error);
        const transitioned = await this.store.fail(
          job.id,
          this.workerId,
          job.attempts,
          failure,
        );
        if (!transitioned) {
          this.logger.warn("review_job_failure_lost_lease", {
            jobId: job.id,
            failureCode: failure.code,
          });
        } else {
          this.logger.warn("review_job_failed", {
            jobId: job.id,
            failureCode: failure.code,
            retryable: failure.retryable,
          });
        }
      }
    } finally {
      clearInterval(timer);
    }

    return true;
  }
}
