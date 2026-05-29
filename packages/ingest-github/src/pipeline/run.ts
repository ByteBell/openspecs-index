import { KnowledgeState, type GithubIndexPayload, type UsageGuard } from "@bb/types";
import { knowledgeDb } from "@bb/db";
import { knowledgeGraph } from "@bb/graph-db";
import { IngestError, UsageLimitExceededError } from "@bb/errors";
import { logger } from "@bb/logger";
import { classifyFailure } from "./failure-classifier.ts";
import { transitionState } from "./pull-helpers.ts";
import { isGithubPayload, persistFailure } from "./run-helpers.ts";
import { runLocal } from "./run-local.ts";
import type { IngestRunnerDeps, IngestRunnerInput } from "#src/types/ingest-runner.ts";
import type { IngestStrategy } from "#src/types/strategy.ts";
import type { ArchiveSink, PipelineSummary, SourceFactory, SourceReader } from "#src/types/pipeline.ts";
import type { ProgressContextFactory } from "#src/progress/types.ts";
import { nullProgressContextFactory } from "#src/progress/NullProgressReporter.ts";
import { ensureCommitDirs, pathsFor, type RepoLocation } from "./paths.ts";
import { readHeadCommitHash, syncRepository } from "./source.ts";
import { resolveBranch } from "./branch.ts";
import { CancellationError, clearCancellation, throwIfCancelled } from "./cancellation.ts";
import { createDiskSourceReader } from "./disk-source-reader.ts";
import { resolveOrgId, llmCallContextFromPayload } from "./context.ts";
import { fetchLatestCommitHash } from "#src/githubApi.ts";
import { parseGithubRepo } from "#src/githubUrl.ts";

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
  let strategyStarted = false;
  try {
    throwIfCancelled(knowledgeId);
    const branch = await resolveBranch(knowledgeId, payload, payload.gitToken);
    await knowledgeDb.setKnowledgeBranch(knowledgeId, branch);
    await knowledgeGraph.setKnowledgeBranchInGraph(knowledgeId, branch).catch(() => undefined);

    const orgId = resolveOrgId(payload);
    // Parse (owner, repo) up front — we need them to build the commit-scoped
    // path *before* cloning. parseGithubRepo handles `.git`, `tree/branch`
    // suffixes, and SSH-style URLs.
    const parsed = parseGithubRepo(payload.repoUrl);
    if (parsed === null) {
      throw new IngestError(knowledgeId, `could not parse owner/repo from repoUrl=${payload.repoUrl}`);
    }

    let source: SourceReader;
    let archiveSink: ArchiveSink | undefined;
    let commitHash: string;
    let location: RepoLocation;

    progressContext.phaseChanged("clone");
    if (sourceFactory !== undefined) {
      const factoryResult = await sourceFactory({ knowledgeId, payload, branch });
      source = factoryResult.source;
      commitHash = factoryResult.commitHash;
      archiveSink = factoryResult.archiveSink;
      location = {
        provider: "github",
        orgId,
        knowledgeId,
        owner: parsed.owner,
        repo: parsed.repo,
        commitHash,
      };
      // The factory has already produced the source tree; meta-output dirs
      // still need to exist before the strategy writes scan-manifest.json.
      // Idempotent — factories that pre-create the layout themselves see no
      // effect.
      await ensureCommitDirs(location);
      logger.info(`pipeline/run: source factory wired (knowledgeId=${knowledgeId}, commit=${commitHash.slice(0, 12)})`);
    } else {
      // Resolve the HEAD commit SHA before cloning so we can clone *directly*
      // into the commit-scoped `repository/` dir — no staging rename. Uses
      // the GitHub REST `/branches/{branch}` endpoint via fetchLatestCommitHash.
      const resolvedSha = await fetchLatestCommitHash(payload.repoUrl, branch, payload.gitToken);
      if (resolvedSha === null) {
        throw new IngestError(
          knowledgeId,
          `could not resolve HEAD commit hash for ${parsed.owner}/${parsed.repo}@${branch} before clone`,
        );
      }
      location = {
        provider: "github",
        orgId,
        knowledgeId,
        owner: parsed.owner,
        repo: parsed.repo,
        commitHash: resolvedSha,
      };
      await ensureCommitDirs(location);
      const repoDir = pathsFor(location).repositoryDir;
      const cloneOpts: { repoUrl: string; branch: string; destinationDir: string; gitToken?: string } = {
        repoUrl: payload.repoUrl,
        branch,
        destinationDir: repoDir,
      };
      if (payload.gitToken !== undefined) {
        cloneOpts.gitToken = payload.gitToken;
      }
      await syncRepository(cloneOpts);
      // Sanity check: the post-clone HEAD must match what we resolved against
      // the REST API. A mismatch means the branch advanced between resolve
      // and clone — rare but worth surfacing.
      const postCloneSha = await readHeadCommitHash(repoDir);
      if (postCloneSha === "unknown") {
        throw new IngestError(knowledgeId, "could not resolve HEAD commit hash after clone");
      }
      commitHash = postCloneSha;
      if (postCloneSha !== resolvedSha) {
        logger.warn(
          `pipeline/run: commit drift between REST and clone for ${knowledgeId} (rest=${resolvedSha.slice(0, 12)} clone=${postCloneSha.slice(0, 12)}); using clone SHA`,
        );
        // Rebuild the location with the post-clone SHA so meta-output lands
        // at the same commit segment as the cloned tree.
        location = { ...location, commitHash: postCloneSha };
        // Repository tree is already at the new commit; meta dirs we ensured
        // earlier are at the old SHA path. Re-ensure under the corrected
        // path so the strategy writes to the right place.
        await ensureCommitDirs(location);
      }
      source = createDiskSourceReader({ repoDir, commitHash });
    }

    progressContext.phaseChanged("scan");
    const metaPaths = pathsFor(location);

    // Persist `source.commitId` BEFORE strategy execution so MCP tools
    // invoked during enrichment (`retrieve_file_content`, `smart_search`)
    // can resolve the on-disk clone via the commit-scoped path layout.
    // The full history entry with token totals is written after the
    // strategy completes via `setKnowledgeCommit`.
    await knowledgeDb.setKnowledgeCommitHead(knowledgeId, commitHash);

    const baseContext: Parameters<typeof strategy.execute>[0]["context"] = {
      knowledgeId,
      orgId,
      repoId: knowledgeId,
    };
    const llmCallContext = llmCallContextFromPayload(payload);
    if (llmCallContext !== undefined) {
      baseContext.llmCallContext = llmCallContext;
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
    strategyStarted = true;
    const result = await strategy.execute(strategyInput);

    await knowledgeDb.setKnowledgeCommit(
      knowledgeId,
      commitHash,
      String(result.tokenUsage.inputTokens),
      String(result.tokenUsage.outputTokens),
      String(result.tokenUsage.costUsd),
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
    await persistFailure(knowledgeId, category, reason, detail);
    if (!strategyStarted) {
      progressContext.failed(reason, undefined, category, detail);
    }
    throw new IngestError(knowledgeId, `github_index pipeline failed: ${reason}`, cause);
  }
}

// `runLocal` lives in `./run-local.ts`. Shared helpers (`transitionState`,
// `persistFailure`, `isGithubPayload`) live in `./pull-helpers.ts` and
// `./run-helpers.ts` so this file stays under the 300-line cap.
