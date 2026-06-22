import type { GithubIndexPayload, JobMessage, LocalIngestPayload, UsageGuard } from "@bb/types";
import type { IngestStrategy } from "./strategy.ts";
import type { PipelineSummary } from "./pipeline.ts";

export interface IngestRunnerInput {
  job: JobMessage<GithubIndexPayload> | JobMessage<LocalIngestPayload>;
  payload: GithubIndexPayload | LocalIngestPayload;
  /**
   * Optional per-job usage guard. Forwarded into the strategy so it can
   * enforce a downstream token quota mid-run. OSS standalone leaves this
   * undefined; the enterprise wrapper builds one per job from the payload.
   */
  usageGuard?: UsageGuard;
}

export interface IngestRunnerDeps {
  reposRootDir: string;
  strategy: IngestStrategy;
  run(input: IngestRunnerInput): Promise<PipelineSummary>;
}
