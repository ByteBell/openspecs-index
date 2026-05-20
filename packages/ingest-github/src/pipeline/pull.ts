import {
  Config,
  KnowledgeState,
  isFullCommitHash,
  resolveIndexedCommit,
  type GithubPullPayload,
  type JobMessage,
} from "@bb/types";
import { getConfigValue } from "@bb/config";
import { getKnowledge, recordProcessingStats, setKnowledgeCommit, setKnowledgeState } from "@bb/mongo";
import { setKnowledgeStateInGraph, snapshotFilesToVersion, type NodeScope } from "@bb/neo4j";
import { estimateCostFromBreakdown } from "@bb/llm";
import { IngestError, KnowledgeNotFoundError } from "@bb/errors";
import { logger } from "@bb/logger";
import { ensureMetaDirs, metaPathsFor, repoCloneDir, ensureReposRoot } from "./paths.ts";
import { readHeadCommitHash, syncRepository } from "./source.ts";
import { CancellationError, clearCancellation, throwIfCancelled } from "./cancellation.ts";
import { assertReachableFromBranch, checkoutCommit } from "./git-diff.ts";
import { computePullDiff, materialiseEndpoints } from "./pull-diff-resolver.ts";
import { affectedFoldersFromDiff } from "./affected-folders.ts";
import { createDiskSourceReader } from "./disk-source-reader.ts";
import { analyseChangedFiles } from "src/strategies/flat-folder/analyse-changed.ts";
import { processBigFilesQueue } from "src/strategies/flat-folder/phases/process-big-files.ts";
import { backfillMissingFields } from "src/strategies/flat-folder/backfill/fields.ts";
import { backfillBigFiles } from "src/strategies/flat-folder/backfill/big-files.ts";
import { runSelectiveFolderSummary } from "src/strategies/flat-folder/folder-summary-selective.ts";
import { makeRepoSummaryEnvelope, persistRepoSummary, summariseRepo } from "src/strategies/flat-folder/repo-summary.ts";
import { storePullAnalysis } from "src/strategies/flat-folder/store-pull.ts";
import { createLlmFileAnalyzer } from "src/adapters/llm-file-analyzer.ts";
import {
  COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT,
  buildFileAnalysisUserPrompt,
} from "src/strategies/flat-folder/prompts/file-analysis.ts";

function resolveOrgId(payload: { orgId?: string }): string {
  if (typeof payload.orgId === "string" && payload.orgId.length > 0) {
    return payload.orgId;
  }
  return getConfigValue(Config.OrgId);
}

export async function runPull(msg: JobMessage<GithubPullPayload>): Promise<void> {
  const { knowledgeId } = msg.payload;
  if (msg.payload.targetCommitHash !== undefined && !isFullCommitHash(msg.payload.targetCommitHash)) {
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
  const currentCommit = resolveIndexedCommit(knowledge.source);
  if (currentCommit === undefined) {
    throw new IngestError(
      knowledgeId,
      "pull requires a previously-indexed commit; this knowledge has no commitId. Run github_index first.",
    );
  }

  const branch = knowledge.source.branch ?? "main";
  const repoUrl = knowledge.source.repoUrl;
  const gitToken = msg.payload.gitToken;

  clearCancellation(knowledgeId);
  const startedAt = Date.now();
  await transitionState(knowledgeId, KnowledgeState.Processing);

  try {
    throwIfCancelled(knowledgeId);
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
    if (!isFullCommitHash(branchHead)) {
      throw new IngestError(knowledgeId, "could not resolve branch HEAD after clone");
    }
    const targetCommit = (msg.payload.targetCommitHash ?? branchHead).toLowerCase();

    if (targetCommit === currentCommit) {
      logger.info(`pull: ${knowledgeId} already at ${targetCommit.slice(0, 12)}; no-op`);
      await transitionState(knowledgeId, KnowledgeState.Processed);
      return;
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

    const diff = await computePullDiff(repoDir, currentCommit, targetCommit);

    throwIfCancelled(knowledgeId);
    await snapshotFilesToVersion({ knowledgeId, commitHash: currentCommit }).catch((cause: unknown) => {
      const msgText = cause instanceof Error ? cause.message : String(cause);
      logger.warn(`pull: snapshot of ${currentCommit.slice(0, 12)} failed (non-fatal): ${msgText}`);
    });

    await checkoutCommit(repoDir, targetCommit);

    const metaPaths = metaPathsFor(knowledgeId);
    await ensureMetaDirs(metaPaths);

    const affectedFolders = affectedFoldersFromDiff(diff);

    const fileAnalyzer = createLlmFileAnalyzer({
      buildSystemPrompt: () => COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT,
      buildUserPrompt: buildFileAnalysisUserPrompt,
    });

    logger.info(`pull: phase per-file dispatcher for ${knowledgeId} starting`);
    throwIfCancelled(knowledgeId);
    await analyseChangedFiles({
      knowledgeId,
      repoDir,
      metaPaths,
      analyzer: fileAnalyzer,
      diff,
    });

    const source = createDiskSourceReader({ repoDir, commitHash: targetCommit });

    logger.info(`pull: phase process big files starting`);
    throwIfCancelled(knowledgeId);
    await processBigFilesQueue({ knowledgeId, source, metaPaths });

    logger.info(`pull: phase backfill fields starting`);
    throwIfCancelled(knowledgeId);
    await backfillMissingFields(metaPaths);

    logger.info(`pull: phase backfill big-files starting`);
    throwIfCancelled(knowledgeId);
    await backfillBigFiles({ knowledgeId, source, metaPaths });

    logger.info(`pull: phase selective folder summary (${affectedFolders.size} folders) starting`);
    throwIfCancelled(knowledgeId);
    await runSelectiveFolderSummary({ knowledgeId, metaPaths, affectedFolders });

    logger.info(`pull: phase repo summary starting`);
    throwIfCancelled(knowledgeId);
    const orgId = resolveOrgId({ ...(knowledge.source.kind === "github" ? {} : {}) });
    const scope: NodeScope = { orgId, knowledgeId, repoId: knowledgeId };
    const repoSummary = await summariseRepo(knowledgeId, metaPaths);
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

    await persistPullStats({
      knowledgeId,
      repoName: repoNameFromUrl(repoUrl),
      commitHash: targetCommit,
      filesAnalyzed: stored.filesUpserted,
      foldersSummarised: stored.foldersUpserted,
      processingTimeMs: Date.now() - startedAt,
    });
    await setKnowledgeCommit(knowledgeId, targetCommit);
    await transitionState(knowledgeId, KnowledgeState.Processed);
    logger.info(
      `pull: ${knowledgeId} ${currentCommit.slice(0, 12)} -> ${targetCommit.slice(0, 12)} done (filesUpserted=${stored.filesUpserted} filesDeleted=${stored.filesDeleted} foldersUpserted=${stored.foldersUpserted})`,
    );
  } catch (cause: unknown) {
    if (cause instanceof CancellationError) {
      clearCancellation(knowledgeId);
      logger.info(`pull: cancelled for ${knowledgeId}`);
      throw cause;
    }
    await transitionState(knowledgeId, KnowledgeState.Failed).catch(() => undefined);
    throw new IngestError(knowledgeId, `github_pull failed: ${describe(cause)}`, cause);
  }
}

async function transitionState(knowledgeId: string, state: KnowledgeState): Promise<void> {
  await setKnowledgeState(knowledgeId, state);
  await setKnowledgeStateInGraph(knowledgeId, state).catch(() => undefined);
}

interface PersistPullStatsInput {
  knowledgeId: string;
  repoName: string;
  commitHash: string;
  filesAnalyzed: number;
  foldersSummarised: number;
  processingTimeMs: number;
}

async function persistPullStats(input: PersistPullStatsInput): Promise<void> {
  const estimatedCost = await estimateCostFromBreakdown({});
  await recordProcessingStats({
    knowledgeId: input.knowledgeId,
    repoName: input.repoName,
    commitHash: input.commitHash,
    modelTokens: {},
    estimatedCost,
    totalBatches: 1,
    totalFiles: input.filesAnalyzed,
    totalFolders: input.foldersSummarised,
    filesAnalyzed: input.filesAnalyzed,
    processingTimeMs: input.processingTimeMs,
  });
}

function repoNameFromUrl(repoUrl: string): string {
  try {
    const segments = new URL(repoUrl).pathname
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const repo = segments.at(-1)?.replace(/\.git$/u, "");
    const owner = segments.at(-2);
    if (owner !== undefined && repo !== undefined) {
      return `${owner}/${repo}`;
    }
  } catch {
    // fall through
  }
  return repoUrl;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
