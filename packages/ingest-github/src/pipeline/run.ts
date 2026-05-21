import { Config, KnowledgeState, isFullCommitHash, type GithubIndexPayload, type LocalIngestPayload } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { recordProcessingStats, setKnowledgeCommit, setKnowledgeState } from "@bb/mongo";
import { setKnowledgeStateInGraph } from "@bb/neo4j";
import { estimateCostFromBreakdown } from "@bb/llm";
import { IngestError } from "@bb/errors";
import { logger } from "@bb/logger";
import type { IngestRunnerDeps, IngestRunnerInput } from "src/types/ingest-runner.ts";
import type { IngestStrategy } from "src/types/strategy.ts";
import type { ArchiveSink, PipelineSummary, SourceFactory, SourceReader } from "src/types/pipeline.ts";
import { ensureMetaDirs, ensureReposRoot, metaPathsFor, repoCloneDir } from "./paths.ts";
import { readHeadCommitHash, syncRepository } from "./source.ts";
import { resolveBranch } from "./branch.ts";
import { CancellationError, clearCancellation, throwIfCancelled } from "./cancellation.ts";
import { createDiskSourceReader } from "./disk-source-reader.ts";

function resolveOrgId(payload: { orgId?: string }): string {
  if (typeof payload.orgId === "string" && payload.orgId.length > 0) {
    return payload.orgId;
  }
  return getConfigValue(Config.OrgId);
}

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
}

export function createPipelineRunner(deps: CreatePipelineRunnerDeps): IngestRunnerDeps {
  return {
    reposRootDir: deps.reposRootDir,
    strategy: deps.strategy,
    run: async (input: IngestRunnerInput): Promise<PipelineSummary> => {
      const payload = input.payload;
      if (isGithubPayload(payload)) {
        return await runGithub(deps.strategy, payload, deps.sourceFactory);
      }
      return await runLocal(deps.strategy, payload);
    },
  };
}

async function runGithub(
  strategy: IngestStrategy,
  payload: GithubIndexPayload,
  sourceFactory: SourceFactory | undefined,
): Promise<PipelineSummary> {
  const { knowledgeId } = payload;
  clearCancellation(knowledgeId);
  const startedAt = Date.now();
  await transitionState(knowledgeId, KnowledgeState.Processing);
  try {
    throwIfCancelled(knowledgeId);
    const branch = resolveBranch(knowledgeId, payload);

    let source: SourceReader;
    let archiveSink: ArchiveSink | undefined;
    let commitHash: string;

    if (sourceFactory !== undefined) {
      const factoryResult = await sourceFactory({ knowledgeId, payload, branch });
      source = factoryResult.source;
      commitHash = factoryResult.commitHash;
      archiveSink = factoryResult.archiveSink;
      logger.info(`pipeline/run: source factory wired (knowledgeId=${knowledgeId}, commit=${commitHash.slice(0, 12)})`);
    } else {
      await ensureReposRoot();
      const repoDir = repoCloneDir(knowledgeId);
      const cloneOpts: { repoUrl: string; branch: string; destinationDir: string; gitToken?: string } = {
        repoUrl: payload.repoUrl,
        branch,
        destinationDir: repoDir,
      };
      if (payload.gitToken !== undefined) {
        cloneOpts.gitToken = payload.gitToken;
      }
      await syncRepository(cloneOpts);
      commitHash = await readHeadCommitHash(repoDir);
      if (commitHash === "unknown") {
        throw new IngestError(knowledgeId, "could not resolve HEAD commit hash after clone");
      }
      source = createDiskSourceReader({ repoDir, commitHash });
    }
    if (!isFullCommitHash(commitHash)) {
      throw new IngestError(knowledgeId, `resolved HEAD is not a full commit hash: ${commitHash}`);
    }
    commitHash = commitHash.toLowerCase();

    const metaPaths = metaPathsFor(knowledgeId);
    await ensureMetaDirs(metaPaths);

    const strategyInput: Parameters<typeof strategy.execute>[0] = {
      payload,
      branch,
      source,
      metaPaths,
      context: { knowledgeId, orgId: resolveOrgId(payload), repoId: knowledgeId },
    };
    if (archiveSink !== undefined) {
      strategyInput.archiveSink = archiveSink;
    }
    const result = await strategy.execute(strategyInput);

    await persistStats({
      knowledgeId,
      repoName: repoNameFromUrl(payload.repoUrl),
      commitHash,
      filesAnalyzed: result.filesAnalyzed,
      foldersSummarised: result.foldersSummarised,
      processingTimeMs: Date.now() - startedAt,
    });
    await setKnowledgeCommit(knowledgeId, commitHash);
    await transitionState(knowledgeId, KnowledgeState.Processed);

    return {
      filesAnalyzed: result.filesAnalyzed,
      foldersSummarised: result.foldersSummarised,
      repoSummarised: result.repoSummarised,
      graphNodesWritten: result.graphNodesWritten,
      commitHash,
    };
  } catch (cause: unknown) {
    if (cause instanceof CancellationError) {
      clearCancellation(knowledgeId);
      logger.info(`pipeline/run: ingestion cancelled for ${knowledgeId}`);
      throw cause;
    }
    await transitionState(knowledgeId, KnowledgeState.Failed).catch(() => undefined);
    throw new IngestError(knowledgeId, `github_index pipeline failed: ${describe(cause)}`, cause);
  }
}

async function runLocal(strategy: IngestStrategy, payload: LocalIngestPayload): Promise<PipelineSummary> {
  const { knowledgeId, rootDir } = payload;
  clearCancellation(knowledgeId);
  const startedAt = Date.now();
  await transitionState(knowledgeId, KnowledgeState.Processing);
  try {
    throwIfCancelled(knowledgeId);
    const metaPaths = metaPathsFor(knowledgeId);
    await ensureMetaDirs(metaPaths);

    const source = createDiskSourceReader({ repoDir: rootDir, commitHash: `local-${startedAt}` });

    const result = await strategy.execute({
      payload: { knowledgeId, repoUrl: `local:${rootDir}` },
      branch: "local",
      source,
      metaPaths,
      context: { knowledgeId, orgId: resolveOrgId(payload), repoId: knowledgeId },
    });

    const commitHash = `local-${startedAt}`;
    await persistStats({
      knowledgeId,
      repoName: localRepoName(rootDir),
      commitHash,
      filesAnalyzed: result.filesAnalyzed,
      foldersSummarised: result.foldersSummarised,
      processingTimeMs: Date.now() - startedAt,
    });
    await transitionState(knowledgeId, KnowledgeState.Processed);
    return {
      filesAnalyzed: result.filesAnalyzed,
      foldersSummarised: result.foldersSummarised,
      repoSummarised: result.repoSummarised,
      graphNodesWritten: result.graphNodesWritten,
      commitHash,
    };
  } catch (cause: unknown) {
    if (cause instanceof CancellationError) {
      clearCancellation(knowledgeId);
      throw cause;
    }
    await transitionState(knowledgeId, KnowledgeState.Failed).catch(() => undefined);
    throw new IngestError(knowledgeId, `local_ingest pipeline failed: ${describe(cause)}`, cause);
  }
}

async function transitionState(knowledgeId: string, state: KnowledgeState): Promise<void> {
  await setKnowledgeState(knowledgeId, state);
  await setKnowledgeStateInGraph(knowledgeId, state).catch(() => undefined);
}

interface PersistStatsInput {
  knowledgeId: string;
  repoName: string;
  commitHash: string;
  filesAnalyzed: number;
  foldersSummarised: number;
  processingTimeMs: number;
}

async function persistStats(input: PersistStatsInput): Promise<void> {
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

function isGithubPayload(payload: GithubIndexPayload | LocalIngestPayload): payload is GithubIndexPayload {
  return (payload as GithubIndexPayload).repoUrl !== undefined;
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

function localRepoName(rootDir: string): string {
  const segments = rootDir.split("/").filter((s) => s.length > 0);
  return segments.at(-1) ?? rootDir;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
