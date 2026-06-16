import { KnowledgeState, type GithubIndexPayload, type UsageGuard } from "@bb/types";
import { knowledgeDb } from "@bb/db";
import { knowledgeGraph } from "@bb/graph-db";
import { IngestError, UsageLimitExceededError } from "@bb/errors";
import { logger } from "@bb/logger";
import {
  classifyFailure,
  isRetryable,
  transitionState,
  isGithubPayload,
  persistFailure,
  persistHalted,
  markNonRetryable,
  nullProgressContextFactory,
  pathsFor,
  CancellationError,
  clearCancellation,
  throwIfCancelled,
  resolveOrgId,
  llmCallContextFromPayload,
  unitsLlmCallContextFromPayload,
  ignoreSetsFromPayload,
  withUsageMeter,
} from "@bb/ingest-core";
import type {
  IngestRunnerDeps,
  IngestRunnerInput,
  IngestStrategy,
  PipelineSummary,
  SourceFactory,
  ProgressContextFactory,
} from "@bb/ingest-core";
import { maybeInjectOneShotHalt } from "./fault-injection.ts";
import { runLocal } from "./run-local.ts";
import { resolveGithubIndexSource } from "./github-index-source.ts";

export interface CreatePipelineRunnerDeps {
  reposRootDir: string;
  strategy: IngestStrategy;
  /**
   * Optional source factory. When provided, GitHub-ingest skips the default
   * disk clone and uses the factory's returned reader instead. The factory is
   * documented in `docs/extension-points.md`; the open-source binary never
   * supplies one.
   */
  sourceFactory?: SourceFactory;
  /**
   * Optional progress context factory. When provided, the runner emits
   * pre-strategy phase changes (`clone`, `scan`) so SSE clients see liveness
   * during the network/disk-bound prelude. Defaults to a no-op.
   */
  progressContextFactory?: ProgressContextFactory;
}

export function createPipelineRunner(deps: CreatePipelineRunnerDeps): IngestRunnerDeps {
  const progressContextFactory = deps.progressContextFactory ?? nullProgressContextFactory;
  return {
    reposRootDir: deps.reposRootDir,
    strategy: deps.strategy,
    run: async (input: IngestRunnerInput): Promise<PipelineSummary> => {
      const payload = input.payload;
      if (isGithubPayload(payload)) {
        return await runGithub(deps.strategy, payload, deps.sourceFactory, progressContextFactory, input.usageGuard);
      }
      return await runLocal(deps.strategy, payload, input.usageGuard);
    },
  };
}

// The OSS public index router. Provider-agnostic orchestration; the github
// source prelude (branch + clone/stream) lives in `resolveGithubIndexSource`.
// A private out-of-tree index router in a downstream package can share the same
// source resolver via injection.
async function runGithub(
  strategy: IngestStrategy,
  payload: GithubIndexPayload,
  sourceFactory: SourceFactory | undefined,
  progressContextFactory: ProgressContextFactory,
  usageGuard: UsageGuard | undefined,
): Promise<PipelineSummary> {
  const { knowledgeId } = payload;
  clearCancellation(knowledgeId);
  const startedAt = Date.now();
  await transitionState(knowledgeId, KnowledgeState.Processing);
  const progressContext = progressContextFactory(knowledgeId);
  try {
    throwIfCancelled(knowledgeId);
    const orgId = resolveOrgId(payload);

    progressContext.phaseChanged("clone");
    const { source, archiveSink, commitHash, branch, location, owner, repo } = await resolveGithubIndexSource({
      knowledgeId,
      payload,
      orgId,
      sourceFactory,
    });
    await knowledgeDb.setKnowledgeBranch(knowledgeId, branch);
    await knowledgeGraph.setKnowledgeBranchInGraph(knowledgeId, branch).catch(() => undefined);

    progressContext.phaseChanged("scan");
    const metaPaths = pathsFor(location);

    // Persist `source.commitId` BEFORE strategy execution so MCP tools invoked
    // during enrichment can resolve the on-disk clone via the commit-scoped path.
    await knowledgeDb.setKnowledgeCommitHead(knowledgeId, commitHash);

    const baseContext: Parameters<typeof strategy.execute>[0]["context"] = {
      knowledgeId,
      orgId,
      repoId: knowledgeId,
      owner,
      repo,
      commitHash,
      ignoreSets: ignoreSetsFromPayload(payload),
    };
    const llmCallContext = withUsageMeter(llmCallContextFromPayload(payload), usageGuard);
    if (llmCallContext !== undefined) {
      baseContext.llmCallContext = llmCallContext;
    }
    const unitsLlmCallContext = withUsageMeter(unitsLlmCallContextFromPayload(payload), usageGuard);
    if (unitsLlmCallContext !== undefined) {
      baseContext.unitsLlmCallContext = unitsLlmCallContext;
    }

    const strategyInput: Parameters<typeof strategy.execute>[0] = {
      payload,
      branch,
      source,
      metaPaths,
      context: baseContext,
    };
    if (archiveSink !== undefined) {
      strategyInput.archiveSink = archiveSink;
    }
    if (usageGuard !== undefined) {
      strategyInput.usageGuard = usageGuard;
    }
    // TEST-ONLY: one-shot forced transient failure to exercise HALTED → retry.
    maybeInjectOneShotHalt(knowledgeId);
    const result = await strategy.execute(strategyInput);

    await knowledgeDb.setKnowledgeCommit(
      knowledgeId,
      commitHash,
      String(result.tokenUsage.inputTokens),
      String(result.tokenUsage.outputTokens),
      String(result.tokenUsage.costUsd),
      String(result.cachedTokenUsage.inputTokens),
      String(result.cachedTokenUsage.outputTokens),
      String(result.cachedTokenUsage.costUsd),
    );
    await transitionState(knowledgeId, KnowledgeState.Processed);

    const totalMs = Date.now() - startedAt;
    logger.info(
      `pipeline/run: ✓ github_index complete (knowledgeId=${knowledgeId}, commit=${commitHash.slice(0, 12)}, files=${result.filesAnalyzed}, folders=${result.foldersSummarised}, nodes=${result.graphNodesWritten}, ${totalMs}ms)`,
    );

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
      logger.info(`pipeline/run: ingestion cancelled for ${knowledgeId}`);
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
      throw new IngestError(knowledgeId, `github_index pipeline failed: ${reason}`, cause);
    }
    await persistFailure(knowledgeId, category, reason, detail);
    progressContext.failed(reason, undefined, category, detail);
    throw markNonRetryable(new IngestError(knowledgeId, `github_index pipeline failed: ${reason}`, cause));
  }
}
