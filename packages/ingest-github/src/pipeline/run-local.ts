import { KnowledgeState, type LocalIngestPayload, type UsageGuard } from "@bb/types";
import { IngestError, UsageLimitExceededError } from "@bb/errors";
import { logger } from "@bb/logger";
import { classifyFailure } from "./failure-classifier.ts";
import { transitionState } from "./pull-helpers.ts";
import { persistFailure } from "./run-helpers.ts";
import type { IngestStrategy } from "#src/types/strategy.ts";
import type { PipelineSummary } from "#src/types/pipeline.ts";
import { ensureCommitDirs, pathsFor, type RepoLocation } from "./paths.ts";
import { CancellationError, clearCancellation, throwIfCancelled } from "./cancellation.ts";
import { createDiskSourceReader } from "./disk-source-reader.ts";
import { resolveOrgId } from "./context.ts";
import { localRepoName } from "./stats.ts";

/**
 * Runs the local-disk ingestion pipeline. Identical control flow to `runGithub`
 * minus the clone step: source tree stays at `payload.rootDir`, only meta-output
 * lives under the kube-v2 commit-scoped tree (commit hash is synthetic).
 *
 * Extracted from `run.ts` to keep that file under the 300-line cap.
 */
export async function runLocal(
  strategy: IngestStrategy,
  payload: LocalIngestPayload,
  usageGuard: UsageGuard | undefined,
): Promise<PipelineSummary> {
  const { knowledgeId, rootDir } = payload;
  clearCancellation(knowledgeId);
  const startedAt = Date.now();
  await transitionState(knowledgeId, KnowledgeState.Processing);
  try {
    throwIfCancelled(knowledgeId);
    // Synthetic commitHash so the layout slot is populated. The source tree
    // stays at `payload.rootDir` (we don't copy local sources into our managed
    // repository/ dir); only meta-output lives under the kube-v2 tree.
    const commitHash = `local-${startedAt}`;
    const orgId = resolveOrgId(payload);
    const location: RepoLocation = { provider: "local", orgId, knowledgeId, commitHash };
    await ensureCommitDirs(location);
    const metaPaths = pathsFor(location);

    const source = createDiskSourceReader({ repoDir: rootDir, commitHash });

    const localStrategyInput: Parameters<typeof strategy.execute>[0] = {
      payload: { knowledgeId, repoUrl: `local:${rootDir}` },
      branch: "local",
      source,
      metaPaths,
      context: { knowledgeId, orgId, repoId: knowledgeId, owner: "local", repo: localRepoName(rootDir), commitHash },
    };
    if (usageGuard !== undefined) {
      localStrategyInput.usageGuard = usageGuard;
    }
    const result = await strategy.execute(localStrategyInput);

    logger.info(
      `pipeline/run: ✓ local_ingest complete (knowledgeId=${knowledgeId}, repo=${localRepoName(rootDir)}, files=${result.filesAnalyzed}, in=${result.tokenUsage.inputTokens}, out=${result.tokenUsage.outputTokens}, cost=$${result.tokenUsage.costUsd})`,
    );
    await transitionState(knowledgeId, KnowledgeState.Processed);
    return {
      filesAnalyzed: result.filesAnalyzed,
      foldersSummarised: result.foldersSummarised,
      repoSummarised: result.repoSummarised,
      graphNodesWritten: result.graphNodesWritten,
      commitHash,
      tokenUsage: result.tokenUsage,
    };
  } catch (cause: unknown) {
    if (cause instanceof CancellationError) {
      clearCancellation(knowledgeId);
      throw cause;
    }
    if (cause instanceof UsageLimitExceededError && usageGuard !== undefined) {
      await usageGuard.flushPartial(cause.cumulative).catch((flushErr: unknown) => {
        logger.warn(
          `pipeline/run: usageGuard.flushPartial failed for ${knowledgeId}: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
        );
      });
    }
    const { category, reason, detail } = classifyFailure(cause);
    await persistFailure(knowledgeId, category, reason, detail);
    throw new IngestError(knowledgeId, `local_ingest pipeline failed: ${reason}`, cause);
  }
}
