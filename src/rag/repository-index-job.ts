import {
  createStructuredLogger,
  errorLogFields,
  type StructuredLogger,
} from "../observability/structured-logger.js";
import { classifyJobFailure, type ClassifiedJobFailure } from "../reviews/job-failure.js";
import type { RepositoryIndexingResult, RepositoryStandardsIndexer } from "./repository-standards-indexer.js";

export interface ClaimedRepositoryIndexJob {
  attempts: number;
  branch: string;
  id: string;
  installationGithubId: bigint;
  owner: string;
  repositoryId: string;
  repositoryName: string;
}

export interface RepositoryIndexJobStore {
  claimNext(workerId: string): Promise<ClaimedRepositoryIndexJob | null>;
  complete(
    job: ClaimedRepositoryIndexJob,
    workerId: string,
    result: RepositoryIndexingResult,
  ): Promise<boolean>;
  fail(
    jobId: string,
    workerId: string,
    attempt: number,
    failure: ClassifiedJobFailure,
  ): Promise<boolean>;
  heartbeat(jobId: string, workerId: string): Promise<boolean>;
}

export interface RepositoryIndexJobHandler {
  process(job: ClaimedRepositoryIndexJob): Promise<RepositoryIndexingResult>;
}

export class RepositoryStandardsIndexJobHandler implements RepositoryIndexJobHandler {
  constructor(private readonly indexer: RepositoryStandardsIndexer) {}

  process(job: ClaimedRepositoryIndexJob): Promise<RepositoryIndexingResult> {
    return this.indexer.index({
      branch: job.branch,
      installationId: Number(job.installationGithubId),
      owner: job.owner,
      repository: job.repositoryName,
      repositoryId: job.repositoryId,
    });
  }
}

export interface RepositoryIndexWorkerOptions {
  heartbeatIntervalMilliseconds?: number;
  logger?: StructuredLogger;
}

export class RepositoryIndexWorker {
  private readonly heartbeatIntervalMilliseconds: number;
  private readonly logger: StructuredLogger;

  constructor(
    private readonly store: RepositoryIndexJobStore,
    private readonly handler: RepositoryIndexJobHandler,
    private readonly workerId: string,
    options: RepositoryIndexWorkerOptions = {},
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
      createStructuredLogger({ baseFields: { component: "repository-index-worker", workerId } });
  }

  async runOnce(): Promise<boolean> {
    const job = await this.store.claimNext(this.workerId);
    if (job === null) {
      return false;
    }

    let leaseLost = false;
    let heartbeatRunning = false;
    const heartbeat = async () => {
      if (leaseLost || heartbeatRunning) {
        return;
      }
      heartbeatRunning = true;
      try {
        if (!(await this.store.heartbeat(job.id, this.workerId))) {
          leaseLost = true;
          this.logger.warn("repository_index_lease_lost", { jobId: job.id });
        }
      } catch (error) {
        this.logger.warn("repository_index_heartbeat_failed", {
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
        const completed = await this.store.complete(job, this.workerId, result);
        if (!completed) {
          this.logger.warn("repository_index_transition_lost_lease", { jobId: job.id });
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
        this.logger.warn("repository_index_failed", {
          failureCode: failure.code,
          jobId: job.id,
          retryable: failure.retryable,
          transitioned,
        });
      }
    } finally {
      clearInterval(timer);
    }
    return true;
  }
}
