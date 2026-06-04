import {
  Config,
  KnowledgeState,
  type GithubPullPayload,
  type JobMessage,
  type UsageGuard,
  type NodeScope,
} from "@bb/types";
import { getConfigValue } from "@bb/config";
import { withConcurrency } from "./concurrency.ts";
import { knowledgeDb } from "@bb/db";
import { knowledgeGraph, filesGraph } from "@bb/graph-db";
import type { PipelineSummary } from "#src/types/pipeline.ts";
import { resolveOrgId, llmCallContextFromPayload } from "./context.ts";
import { IngestError, UsageLimitExceededError } from "@bb/errors";
import { classifyFailure } from "./failure-classifier.ts";
import { transitionState, emptyPullSummary } from "./pull-helpers.ts";
import { preflightPull } from "./pull-preflight.ts";
import { logger } from "@bb/logger";
import { pathsFor } from "./paths.ts";
import { parseGithubRepo } from "#src/githubUrl.ts";
import { CancellationError, clearCancellation, throwIfCancelled } from "./cancellation.ts";
import { affectedFoldersFromDiff } from "./affected-folders.ts";
import { resolvePullSource } from "./pull-source-resolver.ts";
import type { PullFactory } from "#src/types/pipeline.ts";
import type { ProgressContextFactory } from "#src/progress/types.ts";
import { nullProgressContextFactory } from "#src/progress/NullProgressReporter.ts";
import { analyseChangedFiles } from "#src/strategies/flat-folder/analyse-changed.ts";
import { processBigFilesQueue } from "#src/strategies/flat-folder/phases/process-big-files.ts";
import { backfillMissingFields } from "#src/strategies/flat-folder/backfill/fields.ts";
import { FileAnalysisCache } from "#src/strategies/flat-folder/file-analysis-cache.ts";
import { runSelectiveFolderSummary } from "#src/strategies/flat-folder/folder-summary-selective.ts";
import {
  makeRepoSummaryEnvelope,
  persistRepoSummary,
  summariseRepo,
} from "#src/strategies/flat-folder/repo-summary.ts";
import { storePullAnalysis } from "#src/strategies/flat-folder/store-pull.ts";
import { createLlmFileAnalyzer } from "#src/adapters/llm-file-analyzer.ts";
import {
  COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT,
  buildFileAnalysisUserPrompt,
} from "#src/strategies/flat-folder/prompts/file-analysis.ts";

export async function runPull(
  msg: JobMessage<GithubPullPayload>,
  pullFactory?: PullFactory,
  progressContextFactory: ProgressContextFactory = nullProgressContextFactory,
  usageGuard?: UsageGuard,
): Promise<PipelineSummary> {
  const { knowledgeId } = msg.payload;
  const { currentCommit, branch, repoUrl, gitToken } = await preflightPull(msg, pullFactory);

  clearCancellation(knowledgeId);
  await transitionState(knowledgeId, KnowledgeState.Processing);
  const progressContext = progressContextFactory(knowledgeId);

  try {
    throwIfCancelled(knowledgeId);
    // Parse owner/repo up front — the resolver needs them to build the
    // commit-scoped path under the new layout.
    const parsed = parseGithubRepo(repoUrl);
    if (parsed === null) {
      throw new IngestError(knowledgeId, `could not parse owner/repo from repoUrl=${repoUrl}`);
    }
    const orgId = resolveOrgId({});
    // Resolves target SHA via GitHub REST (or operator-supplied), clones into
    // the commit-scoped `repository/` dir, computes the diff. See
    // `pull-source-resolver.ts` for the dance.
    const resolution = await resolvePullSource({
      knowledgeId,
      payload: msg.payload,
      currentCommit,
      branch,
      repoUrl,
      gitToken,
      orgId,
      owner: parsed.owner,
      repo: parsed.repo,
      pullFactory,
    });
    if (resolution.kind === "noop") {
      logger.info(`pull: ${knowledgeId} already at ${resolution.targetCommit.slice(0, 12)}; no-op`);
      await transitionState(knowledgeId, KnowledgeState.Processed);
      return emptyPullSummary(resolution.targetCommit, currentCommit);
    }
    const { source, diff, targetCommit, location, archiveSink } = resolution;
    // Copy-forward the raw-file snapshot: seed the target commit's archive folder
    // from the parent so it is a complete tree before changed files are pushed
    // over it, then drop deleted / renamed-away paths. No-ops for sinks that are
    // not commit-namespaced; failures are non-fatal (matches the archive contract).
    if (archiveSink !== undefined) {
      try {
        await archiveSink.forkFrom?.(currentCommit);
        for (const removed of [...diff.deleted, ...diff.renamed.map((r) => r.oldPath)]) {
          await archiveSink.remove?.(removed);
        }
      } catch (cause: unknown) {
        logger.warn(
          `pull: archive copy-forward ${currentCommit.slice(0, 12)} -> ${targetCommit.slice(0, 12)} failed (non-fatal): ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }

    throwIfCancelled(knowledgeId);
    await filesGraph.snapshotFilesToVersion({ knowledgeId, commitHash: currentCommit }).catch((cause: unknown) => {
      const msgText = cause instanceof Error ? cause.message : String(cause);
      logger.warn(`pull: snapshot of ${currentCommit.slice(0, 12)} failed (non-fatal): ${msgText}`);
    });

    // Meta-output for the new target commit. Past commits' meta-output stays
    // untouched in its own sibling dir.
    const metaPaths = pathsFor(location);

    const affectedFolders = affectedFoldersFromDiff(diff);

    const fileAnalyzer = createLlmFileAnalyzer({
      buildSystemPrompt: () => COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT,
      buildUserPrompt: buildFileAnalysisUserPrompt,
    });

    const llmCallContext = llmCallContextFromPayload(msg.payload);

    progressContext.phaseChanged("file_analysis");
    logger.info(`pull: phase per-file dispatcher for ${knowledgeId} starting`);
    throwIfCancelled(knowledgeId);
    const analyseChangedInput: Parameters<typeof analyseChangedFiles>[0] = {
      knowledgeId,
      source,
      metaPaths,
      analyzer: fileAnalyzer,
      diff,
      progressContext,
    };
    if (llmCallContext !== undefined) {
      analyseChangedInput.llmCallContext = llmCallContext;
    }
    if (archiveSink !== undefined) {
      analyseChangedInput.archiveSink = archiveSink;
    }
    const phase1 = await analyseChangedFiles(analyseChangedInput);
    let totalInputTokens = phase1.tokenUsage.inputTokens;
    let totalOutputTokens = phase1.tokenUsage.outputTokens;
    let totalCostUsd = phase1.tokenUsage.costUsd;
    await usageGuard?.onPhaseComplete("file_analysis_changed", {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: totalCostUsd,
    });

    logger.info(`pull: phase process big files starting`);
    throwIfCancelled(knowledgeId);
    const processBigFilesInput: Parameters<typeof processBigFilesQueue>[0] = {
      knowledgeId,
      source,
      metaPaths,
      progressContext,
    };
    if (llmCallContext !== undefined) {
      processBigFilesInput.llmCallContext = llmCallContext;
    }
    const phase2 = await processBigFilesQueue(processBigFilesInput);
    totalInputTokens += phase2.tokenUsage.inputTokens;
    totalOutputTokens += phase2.tokenUsage.outputTokens;
    totalCostUsd += phase2.tokenUsage.costUsd;
    await usageGuard?.onPhaseComplete("big_file_analysis", {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: totalCostUsd,
    });

    logger.info(`pull: loading file-analysis cache`);
    throwIfCancelled(knowledgeId);
    const fileAnalysisCache = await FileAnalysisCache.loadAll(metaPaths);
    const limiter = withConcurrency(getConfigValue(Config.LlmConcurrency));

    logger.info(`pull: phase backfill fields starting`);
    throwIfCancelled(knowledgeId);
    await backfillMissingFields(metaPaths, fileAnalysisCache, limiter, llmCallContext, progressContext);

    progressContext.phaseChanged("folder_analysis");
    logger.info(`pull: phase selective folder summary (${affectedFolders.size} folders) starting`);
    throwIfCancelled(knowledgeId);
    const selectiveInput: Parameters<typeof runSelectiveFolderSummary>[0] = {
      knowledgeId,
      metaPaths,
      cache: fileAnalysisCache,
      limiter,
      affectedFolders,
    };
    if (llmCallContext !== undefined) {
      selectiveInput.llmCallContext = llmCallContext;
    }
    const phase5 = await runSelectiveFolderSummary(selectiveInput);
    totalInputTokens += phase5.tokenUsage.inputTokens;
    totalOutputTokens += phase5.tokenUsage.outputTokens;
    totalCostUsd += phase5.tokenUsage.costUsd;
    await usageGuard?.onPhaseComplete("folder_analysis", {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: totalCostUsd,
    });

    progressContext.phaseChanged("indexing");
    logger.info(`pull: phase repo summary starting`);
    throwIfCancelled(knowledgeId);
    const scope: NodeScope = { orgId, knowledgeId, repoId: knowledgeId };
    const { summary: repoSummary, tokenUsage: repoUsage } = await summariseRepo(knowledgeId, metaPaths, llmCallContext);
    totalInputTokens += repoUsage.inputTokens;
    totalOutputTokens += repoUsage.outputTokens;
    totalCostUsd += repoUsage.costUsd;
    await usageGuard?.onPhaseComplete("repo_summary", {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: totalCostUsd,
    });
    if (repoSummary !== null) {
      await persistRepoSummary(metaPaths, makeRepoSummaryEnvelope(knowledgeId, orgId, repoSummary));
    }

    logger.info(`pull: phase graph store starting`);
    throwIfCancelled(knowledgeId);
    const stored = await storePullAnalysis({
      scope,
      payload: { knowledgeId, repoUrl, branch },
      branch,
      owner: parsed.owner,
      repo: parsed.repo,
      commitHash: targetCommit,
      metaPaths,
      diff,
      affectedFolders,
    });

    // No-op (for stats): the pull spent no LLM tokens and upserted nothing — there was
    // nothing that needed analysis. Covers an empty diff, a diff whose changed files were
    // all filtered out as non-analyzable (lockfiles, docs, binaries, …), AND a delete-only
    // pull (deletions consume no tokens). Any real deletions were already applied to the
    // graph by `storePullAnalysis` above; we only avoid recording a misleading zero entry.
    // Keep the knowledge anchored at `currentCommit` (do NOT advance via setKnowledgeCommit)
    // and report a no-op so the enterprise mirror carries the base commit's stats forward.
    const noAnalysisPerformed =
      totalInputTokens === 0 && totalOutputTokens === 0 && stored.filesUpserted === 0 && stored.foldersUpserted === 0;
    if (noAnalysisPerformed) {
      await transitionState(knowledgeId, KnowledgeState.Processed);
      progressContext.completed("github_pull complete (no-op)");
      logger.info(
        `pull: ${knowledgeId} ${currentCommit.slice(0, 12)} -> ${targetCommit.slice(0, 12)} no analyzable changes; no-op`,
      );
      return emptyPullSummary(targetCommit, currentCommit);
    }

    await knowledgeDb.setKnowledgeCommit(
      knowledgeId,
      targetCommit,
      String(totalInputTokens),
      String(totalOutputTokens),
      String(totalCostUsd),
    );
    await transitionState(knowledgeId, KnowledgeState.Processed);
    progressContext.completed("github_pull complete");
    logger.info(
      `pull: ${knowledgeId} ${currentCommit.slice(0, 12)} -> ${targetCommit.slice(0, 12)} done (filesUpserted=${stored.filesUpserted} filesDeleted=${stored.filesDeleted} foldersUpserted=${stored.foldersUpserted})`,
    );
    return {
      filesAnalyzed: stored.filesUpserted,
      foldersSummarised: stored.foldersUpserted,
      repoSummarised: repoSummary !== null,
      graphNodesWritten: stored.filesUpserted + stored.foldersUpserted,
      commitHash: targetCommit,
      tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: totalCostUsd },
    };
  } catch (cause: unknown) {
    if (cause instanceof CancellationError) {
      clearCancellation(knowledgeId);
      logger.info(`pull: cancelled for ${knowledgeId}`);
      throw cause;
    }
    if (cause instanceof UsageLimitExceededError && usageGuard !== undefined) {
      await usageGuard.flushPartial(cause.cumulative).catch((flushErr: unknown) => {
        logger.warn(
          `pull: usageGuard.flushPartial failed for ${knowledgeId}: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
        );
      });
    }
    const { category, reason, detail } = classifyFailure(cause);
    await knowledgeDb.markKnowledgeFailed(knowledgeId, reason, category, detail).catch(() => undefined);
    await knowledgeGraph.setKnowledgeStateInGraph(knowledgeId, KnowledgeState.Failed).catch(() => undefined);
    progressContext.failed(reason, undefined, category, detail);
    throw new IngestError(knowledgeId, `github_pull failed: ${reason}`, cause);
  }
}
