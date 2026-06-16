import {
  Config,
  KnowledgeState,
  type GithubPullPayload,
  type JobMessage,
  type UsageGuard,
  type NodeScope,
} from "@bb/types";
import { getConfigValue } from "@bb/config";
import { withConcurrency } from "@bb/ingest-core";
import { knowledgeDb } from "@bb/db";
import { filesGraph } from "@bb/graph-db";
import type { PipelineSummary } from "@bb/ingest-core";
import { resolveOrgId, llmCallContextFromPayload, ignoreSetsFromPayload, withUsageMeter } from "@bb/ingest-core";
import { IngestError } from "@bb/errors";
import { transitionState, emptyPullSummary } from "@bb/ingest-core";
import { throwPullFailure } from "@bb/ingest-core";
import { preflightPull } from "@bb/ingest-core";
import { logger } from "@bb/logger";
import { pathsFor } from "@bb/ingest-core";
import { parseGithubRepo } from "#src/githubUrl.ts";
import { clearCancellation, throwIfCancelled } from "@bb/ingest-core";
import { affectedFoldersFromDiff } from "@bb/ingest-core";
import { resolvePullSource } from "./pull-source-resolver.ts";
import type { PullFactory } from "@bb/ingest-core";
import type { ProgressContextFactory } from "@bb/ingest-core";
import { nullProgressContextFactory } from "@bb/ingest-core";
import { analyseChangedFiles } from "@bb/ingest-strategies";
import { processBigFilesQueue } from "@bb/ingest-core";
import { backfillMissingFields } from "@bb/ingest-core";
import { FileAnalysisCache } from "@bb/ingest-core";
import { runSelectiveFolderSummary } from "@bb/ingest-strategies";
import { makeRepoSummaryEnvelope, persistRepoSummary, summariseRepo } from "@bb/ingest-strategies";
import { storePullAnalysis } from "@bb/ingest-strategies";
import { createTokenAccumulator } from "@bb/ingest-core";
import { createLlmFileAnalyzer } from "@bb/ingest-core";
import { COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT, buildFileAnalysisUserPrompt } from "@bb/ingest-core";

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
    // Use the job payload's orgId (multi-tenant UUID), not an empty object —
    // `resolveOrgId({})` would fall back to Config.OrgId (the env ORG_ID slug) and
    // overwrite the index-written `Knowledge.org_id`, dropping the KB out of the
    // MCP's org scope. Mirrors the index path (run.ts). OSS single-tenant payloads
    // have no orgId, so this still resolves to Config.OrgId ("local") there.
    const orgId = resolveOrgId(msg.payload);
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

    // Bridge the per-job usage guard onto the LLM context so every fresh call
    // is metered to the user's bill progressively (see `withUsageMeter`).
    const llmCallContext = withUsageMeter(llmCallContextFromPayload(msg.payload), usageGuard);

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
      ignoreSets: ignoreSetsFromPayload(msg.payload),
    };
    if (llmCallContext !== undefined) {
      analyseChangedInput.llmCallContext = llmCallContext;
    }
    if (archiveSink !== undefined) {
      analyseChangedInput.archiveSink = archiveSink;
    }
    const phase1 = await analyseChangedFiles(analyseChangedInput);
    // The guard meters BILLABLE (fresh = total − cached) usage only.
    const usage = createTokenAccumulator();
    usage.add(phase1.tokenUsage, phase1.cachedTokenUsage);
    await usageGuard?.onPhaseComplete("file_analysis_changed", usage.fresh());

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
    usage.add(phase2.tokenUsage, phase2.cachedTokenUsage);
    await usageGuard?.onPhaseComplete("big_file_analysis", usage.fresh());

    logger.info(`pull: loading file-analysis cache`);
    throwIfCancelled(knowledgeId);
    const fileAnalysisCache = await FileAnalysisCache.loadAll(metaPaths);
    const limiter = withConcurrency(getConfigValue(Config.LlmConcurrency));

    logger.info(`pull: phase backfill fields starting`);
    throwIfCancelled(knowledgeId);
    const backfill = await backfillMissingFields(
      metaPaths,
      fileAnalysisCache,
      limiter,
      llmCallContext,
      progressContext,
    );
    usage.add(backfill.tokenUsage, backfill.cachedTokenUsage);

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
    usage.add(phase5.tokenUsage, phase5.cachedTokenUsage);
    await usageGuard?.onPhaseComplete("folder_analysis", usage.fresh());

    progressContext.phaseChanged("indexing");
    logger.info(`pull: phase repo summary starting`);
    throwIfCancelled(knowledgeId);
    const scope: NodeScope = { orgId, knowledgeId, repoId: knowledgeId };
    const {
      summary: repoSummary,
      tokenUsage: repoUsage,
      cachedTokenUsage: repoCached,
    } = await summariseRepo(knowledgeId, metaPaths, llmCallContext);
    usage.add(repoUsage, repoCached);
    await usageGuard?.onPhaseComplete("repo_summary", usage.fresh());
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
    const totals = usage.total();
    const noAnalysisPerformed =
      totals.inputTokens === 0 &&
      totals.outputTokens === 0 &&
      stored.filesUpserted === 0 &&
      stored.foldersUpserted === 0;
    if (noAnalysisPerformed) {
      await transitionState(knowledgeId, KnowledgeState.Processed);
      progressContext.completed("github_pull complete (no-op)");
      logger.info(
        `pull: ${knowledgeId} ${currentCommit.slice(0, 12)} -> ${targetCommit.slice(0, 12)} no analyzable changes; no-op`,
      );
      return emptyPullSummary(targetCommit, currentCommit);
    }

    const cached = usage.cached();
    await knowledgeDb.setKnowledgeCommit(
      knowledgeId,
      targetCommit,
      String(totals.inputTokens),
      String(totals.outputTokens),
      String(totals.costUsd),
      String(cached.inputTokens),
      String(cached.outputTokens),
      String(cached.costUsd),
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
      tokenUsage: totals,
      cachedTokenUsage: cached,
    };
  } catch (cause: unknown) {
    return await throwPullFailure(cause, {
      knowledgeId,
      usageGuard,
      progressContext,
      ...(msg.payload.isAutoPull === true ? { isAutoPull: true } : {}),
    });
  }
}
