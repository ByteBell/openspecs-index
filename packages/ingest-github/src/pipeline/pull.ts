import { Config, KnowledgeState, type GithubPullPayload, type JobMessage } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { withConcurrency } from "./concurrency.ts";
import { getKnowledge, markKnowledgeFailed, setKnowledgeCommit, setKnowledgeState } from "@bb/mongo";
import { setKnowledgeStateInGraph, snapshotFilesToVersion, type NodeScope } from "@bb/neo4j";
import type { PipelineSummary } from "#src/types/pipeline.ts";
import { resolveOrgId, llmCallContextFromPayload } from "./context.ts";
import { IngestError, KnowledgeNotFoundError } from "@bb/errors";
import { classifyFailure } from "./failure-classifier.ts";
import { logger } from "@bb/logger";
import { ensureMetaDirs, metaPathsFor, repoCloneDir, ensureReposRoot } from "./paths.ts";
import { readHeadCommitHash, syncRepository } from "./source.ts";
import { CancellationError, clearCancellation, throwIfCancelled } from "./cancellation.ts";
import { assertReachableFromBranch, checkoutCommit, type DiffResult } from "./git-diff.ts";
import { computePullDiff, materialiseEndpoints } from "./pull-diff-resolver.ts";
import { affectedFoldersFromDiff } from "./affected-folders.ts";
import { createDiskSourceReader } from "./disk-source-reader.ts";
import type { PullFactory, SourceReader, ArchiveSink } from "#src/types/pipeline.ts";
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

const COMMIT_HASH_RE = /^[0-9a-f]{40}$/u;

export async function runPull(
  msg: JobMessage<GithubPullPayload>,
  pullFactory?: PullFactory,
  progressContextFactory: ProgressContextFactory = nullProgressContextFactory,
): Promise<PipelineSummary> {
  const { knowledgeId } = msg.payload;
  if (msg.payload.targetCommitHash !== undefined && !COMMIT_HASH_RE.test(msg.payload.targetCommitHash)) {
    throw new IngestError(
      knowledgeId,
      `targetCommitHash must be a 40-character hex SHA, got: ${msg.payload.targetCommitHash}`,
    );
  }

  const knowledge = await getKnowledge(knowledgeId);
  if (knowledge === null) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
  if (knowledge.source.kind !== "github") {
    throw new IngestError(knowledgeId, `pull is only supported for github knowledge (kind=${knowledge.source.kind})`);
  }
  const currentCommit = knowledge.source.commitId ?? "";
  if (currentCommit.length === 0) {
    throw new IngestError(
      knowledgeId,
      "pull requires a previously-indexed commit; this knowledge has no commitId. Run github_index first.",
    );
  }

  const branch = knowledge.info.branch ?? "main";
  const repoUrl = knowledge.info.repoUrl;
  if (repoUrl === undefined || repoUrl.length === 0) {
    throw new IngestError(knowledgeId, "pull requires knowledge.info.repoUrl");
  }
  const gitToken = msg.payload.gitToken;

  clearCancellation(knowledgeId);
  await transitionState(knowledgeId, KnowledgeState.Processing);
  const progressContext = progressContextFactory(knowledgeId);

  try {
    throwIfCancelled(knowledgeId);

    let source: SourceReader;
    let diff: DiffResult;
    let targetCommit: string;
    let archiveSink: ArchiveSink | undefined;

    if (pullFactory !== undefined) {
      const factoryResult = await pullFactory({ knowledgeId, payload: msg.payload, currentCommit, branch });
      source = factoryResult.source;
      diff = factoryResult.diff;
      targetCommit = factoryResult.targetCommit;
      archiveSink = factoryResult.archiveSink;
      logger.info(`pull: pull factory wired (knowledgeId=${knowledgeId}, target=${targetCommit.slice(0, 12)})`);
      if (targetCommit === currentCommit) {
        logger.info(`pull: ${knowledgeId} already at ${targetCommit.slice(0, 12)}; no-op`);
        await transitionState(knowledgeId, KnowledgeState.Processed);
        return emptyPullSummary(targetCommit);
      }
    } else {
      await ensureReposRoot();
      const repoDir = repoCloneDir(knowledgeId);
      const cloneOpts: { repoUrl: string; branch: string; destinationDir: string; gitToken?: string } = {
        repoUrl,
        branch,
        destinationDir: repoDir,
      };
      if (gitToken !== undefined) {
        cloneOpts.gitToken = gitToken;
      }
      await syncRepository(cloneOpts);

      const branchHead = await readHeadCommitHash(repoDir);
      if (branchHead === "unknown") {
        throw new IngestError(knowledgeId, "could not resolve branch HEAD after clone");
      }
      targetCommit = msg.payload.targetCommitHash ?? branchHead;

      if (targetCommit === currentCommit) {
        logger.info(`pull: ${knowledgeId} already at ${targetCommit.slice(0, 12)}; no-op`);
        await transitionState(knowledgeId, KnowledgeState.Processed);
        return emptyPullSummary(targetCommit);
      }

      // Deepen the shallow clone first so historical commits selected via the
      // picker become visible to `merge-base --is-ancestor`. Without this the
      // assertion below rejects every non-HEAD pick on a `--depth=1` clone.
      await materialiseEndpoints(repoDir, branch, currentCommit, targetCommit);

      if (!(await assertReachableFromBranch(repoDir, targetCommit, branch))) {
        throw new IngestError(
          knowledgeId,
          `target commit ${targetCommit} is not reachable from origin/${branch}. Cross-branch pulls are not supported; create a fresh github_index job for the new branch.`,
        );
      }

      diff = await computePullDiff(repoDir, currentCommit, targetCommit);
      await checkoutCommit(repoDir, targetCommit);
      source = createDiskSourceReader({ repoDir, commitHash: targetCommit });
    }

    logger.info(
      `pull: ${knowledgeId} ${currentCommit.slice(0, 12)} → ${targetCommit.slice(0, 12)} ` +
        `added=${diff.added.length} modified=${diff.modified.length} ` +
        `deleted=${diff.deleted.length} renamed=${diff.renamed.length}`,
    );

    throwIfCancelled(knowledgeId);
    await snapshotFilesToVersion({ knowledgeId, commitHash: currentCommit }).catch((cause: unknown) => {
      const msgText = cause instanceof Error ? cause.message : String(cause);
      logger.warn(`pull: snapshot of ${currentCommit.slice(0, 12)} failed (non-fatal): ${msgText}`);
    });

    const metaPaths = metaPathsFor(knowledgeId);
    await ensureMetaDirs(metaPaths);

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

    progressContext.phaseChanged("indexing");
    logger.info(`pull: phase repo summary starting`);
    throwIfCancelled(knowledgeId);
    const orgId = resolveOrgId({ ...(knowledge.source.kind === "github" ? {} : {}) });
    const scope: NodeScope = { orgId, knowledgeId, repoId: knowledgeId };
    const { summary: repoSummary, tokenUsage: repoUsage } = await summariseRepo(knowledgeId, metaPaths, llmCallContext);
    totalInputTokens += repoUsage.inputTokens;
    totalOutputTokens += repoUsage.outputTokens;
    totalCostUsd += repoUsage.costUsd;
    if (repoSummary !== null) {
      await persistRepoSummary(metaPaths, makeRepoSummaryEnvelope(knowledgeId, orgId, repoSummary));
    }

    logger.info(`pull: phase graph store starting`);
    throwIfCancelled(knowledgeId);
    const stored = await storePullAnalysis({
      scope,
      payload: { knowledgeId, repoUrl, branch },
      branch,
      metaPaths,
      diff,
      affectedFolders,
    });

    await setKnowledgeCommit(
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
    const { category, reason, detail } = classifyFailure(cause);
    await markKnowledgeFailed(knowledgeId, reason, category, detail).catch(() => undefined);
    await setKnowledgeStateInGraph(knowledgeId, KnowledgeState.Failed).catch(() => undefined);
    progressContext.failed(reason, undefined, category, detail);
    throw new IngestError(knowledgeId, `github_pull failed: ${reason}`, cause);
  }
}

async function transitionState(knowledgeId: string, state: KnowledgeState): Promise<void> {
  await setKnowledgeState(knowledgeId, state);
  await setKnowledgeStateInGraph(knowledgeId, state).catch(() => undefined);
}

function emptyPullSummary(commitHash: string): PipelineSummary {
  return {
    filesAnalyzed: 0,
    foldersSummarised: 0,
    repoSummarised: false,
    graphNodesWritten: 0,
    commitHash,
    tokenUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
}
