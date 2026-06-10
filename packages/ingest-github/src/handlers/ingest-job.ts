import type { GithubIndexPayload, JobMessage, LocalIngestPayload, UsageGuard } from "@bb/types";
import { IngestError } from "@bb/errors";
import { withRepoLog } from "@bb/logger";
import { isEnvelopeCoherent, narrowGithubIngest, narrowLocalIngest } from "#src/payload/narrow.ts";
import { githubRepoLogLabel, localRepoLogLabel } from "#src/handlers/repo-log-label.ts";
import type { IngestRunnerDeps, IngestRunnerInput } from "#src/types/ingest-runner.ts";
import type { PipelineSummary } from "#src/types/pipeline.ts";

export interface IngestJobHandlerDeps {
  runner: IngestRunnerDeps;
  /**
   * Optional per-job usage-guard factory. When supplied, the handler invokes
   * it once per job with the narrowed payload and forwards the resulting
   * guard to `runner.run(...)`. OSS standalone leaves this undefined and the
   * pipeline runs without any quota enforcement.
   */
  usageGuardFactory?: (payload: GithubIndexPayload | LocalIngestPayload) => UsageGuard | undefined;
}

export function createGithubIngestHandler(
  deps: IngestJobHandlerDeps,
): (msg: JobMessage<GithubIndexPayload>) => Promise<PipelineSummary> {
  return async function handleGithubIngest(msg: JobMessage<GithubIndexPayload>): Promise<PipelineSummary> {
    const payload = narrowGithubIngest(msg.knowledgeId, msg.payload);
    if (!isEnvelopeCoherent(msg.knowledgeId, payload.knowledgeId)) {
      throw new IngestError(
        msg.knowledgeId,
        `envelope mismatch: job.knowledgeId=${msg.knowledgeId} payload.knowledgeId=${payload.knowledgeId}`,
      );
    }
    const input: IngestRunnerInput = { job: msg, payload };
    const usageGuard = deps.usageGuardFactory?.(payload);
    if (usageGuard !== undefined) {
      input.usageGuard = usageGuard;
    }
    return await withRepoLog({ knowledgeId: payload.knowledgeId, label: githubRepoLogLabel(payload) }, () =>
      deps.runner.run(input),
    );
  };
}

export function createLocalIngestHandler(
  deps: IngestJobHandlerDeps,
): (msg: JobMessage<LocalIngestPayload>) => Promise<PipelineSummary> {
  return async function handleLocalIngest(msg: JobMessage<LocalIngestPayload>): Promise<PipelineSummary> {
    const payload = narrowLocalIngest(msg.knowledgeId, msg.payload);
    if (!isEnvelopeCoherent(msg.knowledgeId, payload.knowledgeId)) {
      throw new IngestError(
        msg.knowledgeId,
        `envelope mismatch: job.knowledgeId=${msg.knowledgeId} payload.knowledgeId=${payload.knowledgeId}`,
      );
    }
    const input: IngestRunnerInput = { job: msg, payload };
    const usageGuard = deps.usageGuardFactory?.(payload);
    if (usageGuard !== undefined) {
      input.usageGuard = usageGuard;
    }
    return await withRepoLog({ knowledgeId: payload.knowledgeId, label: localRepoLogLabel(payload) }, () =>
      deps.runner.run(input),
    );
  };
}
