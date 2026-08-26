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
  cancel(jobId: string): Promise<void>;
  claimNext(workerId: string): Promise<ClaimedReviewJob | null>;
  complete(jobId: string): Promise<void>;
  fail(jobId: string, attempt: number, error: Error): Promise<void>;
}

export interface ReviewJobHandler {
  process(job: ClaimedReviewJob): Promise<"cancelled" | void>;
}

export class ReviewJobWorker {
  constructor(
    private readonly store: ReviewJobStore,
    private readonly handler: ReviewJobHandler,
    private readonly workerId: string,
  ) {}

  async runOnce(): Promise<boolean> {
    const job = await this.store.claimNext(this.workerId);
    if (job === null) {
      return false;
    }

    try {
      const result = await this.handler.process(job);
      if (result === "cancelled") {
        await this.store.cancel(job.id);
      } else {
        await this.store.complete(job.id);
      }
    } catch (error) {
      await this.store.fail(
        job.id,
        job.attempts,
        error instanceof Error ? error : new Error("Unknown review job failure."),
      );
    }

    return true;
  }
}
