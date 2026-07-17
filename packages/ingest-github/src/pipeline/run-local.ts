import { KnowledgeState, type LocalIngestPayload, type UsageGuard } from "@bb/types";
import { IngestError, UsageLimitExceededError } from "@bb/errors";
import { logger } from "@bb/logger";
import { classifyFailure, isRetryable } from "@bb/ingest-core";
import { transitionState } from "@bb/ingest-core";
import { persistFailure, persistHalted, markNonRetryable } from "@bb/ingest-core";
import type { IngestStrategy } from "@bb/ingest-core";
import type { PipelineSummary } from "@bb/ingest-core";
import { ensureCommitDirs, pathsFor, type RepoLocation } from "@bb/ingest-core";
import { CancellationError, clearCancellation, throwIfCancelled } from "@bb/ingest-core";
import { createDiskSourceReader } from "@bb/ingest-core";
import { resolveOrgId, withUsageMeter } from "@bb/ingest-core";
import { localRepoName } from "@bb/ingest-core";

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
    // Local sources have no git branch; use a stable synthetic segment so the
    // branch-scoped layout slot is populated.
    const location: RepoLocation = { provider: "local", orgId, knowledgeId, branch: "main", commitHash };
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
    // Meter fresh LLM usage progressively when a guard is present.
    const llmCallContext = withUsageMeter(undefined, usageGuard);
    if (llmCallContext !== undefined) {
      localStrategyInput.context.llmCallContext = llmCallContext;
    }
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
      cachedTokenUsage: result.cachedTokenUsage,
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
    if (isRetryable(category)) {
      await persistHalted(knowledgeId, category, reason, detail);
      throw new IngestError(knowledgeId, `local_ingest pipeline failed: ${reason}`, cause);
    }
    await persistFailure(knowledgeId, category, reason, detail);
    throw markNonRetryable(new IngestError(knowledgeId, `local_ingest pipeline failed: ${reason}`, cause));
  }
}
