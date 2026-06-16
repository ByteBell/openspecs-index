import path from "node:path";
import { JobType } from "@bb/types";
import { getBytebellHome } from "@bb/config";
import { registerWorker } from "@bb/queue";
import type { PullFactory, SourceFactory, ProgressContextFactory } from "@bb/ingest-core";
import { createLlmFileAnalyzer, dbProgressContextFactory, orgsRoot } from "@bb/ingest-core";
import { COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT, buildFileAnalysisUserPrompt } from "@bb/ingest-core";
import { pickStrategy } from "@bb/ingest-strategies";
import { createPipelineRunner } from "./pipeline/run.ts";
import { runPull } from "./pipeline/pull.ts";
import { createGithubIngestHandler, createLocalIngestHandler } from "./handlers/ingest-job.ts";

/**
 * Optional dependencies for the GitHub workers. Factories are documented in
 * `docs/extension-points.md`. The open-source binary leaves them undefined —
 * index and pull use the default disk-backed readers, and progress events
 * are discarded by `nullProgressContextFactory`.
 */
export interface RegisterGithubWorkersDeps {
  sourceFactory?: SourceFactory;
  pullFactory?: PullFactory;
  progressContextFactory?: ProgressContextFactory;
}

function buildRunner(
  sourceFactory: SourceFactory | undefined,
  progressContextFactory: ProgressContextFactory,
): ReturnType<typeof createPipelineRunner> {
  const fileAnalyzer = createLlmFileAnalyzer({
    buildSystemPrompt: () => COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT,
    buildUserPrompt: buildFileAnalysisUserPrompt,
  });
  const strategy = pickStrategy({ fileAnalyzer, progressContextFactory });
  const runnerDeps: Parameters<typeof createPipelineRunner>[0] = {
    reposRootDir: orgsRoot(),
    strategy,
    progressContextFactory,
  };
  if (sourceFactory !== undefined) {
    runnerDeps.sourceFactory = sourceFactory;
  }
  return createPipelineRunner(runnerDeps);
}

export function registerGithubWorkers(deps: RegisterGithubWorkersDeps = {}): void {
  const progressContextFactory = deps.progressContextFactory ?? dbProgressContextFactory;
  const runner = buildRunner(deps.sourceFactory, progressContextFactory);
  // `registerWorker` expects `Promise<void>`; the handler now returns
  // `Promise<PipelineSummary>` so the enterprise queue bridge can mirror
  // per-commit tokens + cost into the knowledge record. The OSS in-process
  // worker discards the summary — local stats are read off
  // `source.commitHashes[]` via `bytebell stats` instead.
  const indexHandler = createGithubIngestHandler({ runner });
  registerWorker(JobType.GithubIndex, async (msg) => {
    await indexHandler(msg);
  });
  const pullFactory = deps.pullFactory;
  registerWorker(JobType.GithubPull, async (msg) => {
    await runPull(msg, pullFactory, progressContextFactory);
  });
}

export function registerLocalIngestWorker(): void {
  const runner = buildRunner(undefined, dbProgressContextFactory);
  const localHandler = createLocalIngestHandler({ runner });
  registerWorker(JobType.LocalIngest, async (msg) => {
    await localHandler(msg);
  });
}

/**
 * Compatibility shim — the legacy `<bytebellHome>/repos/` directory still
 * hosts the LLM-decision cache (`repos/llmdecisions/`) and the
 * local-snapshots staging dir for `localIndexRoute`. Knowledge / ingest
 * artifacts moved to the commit-scoped `orgs/` tree, but `reposRoot()` is
 * preserved as a stable handle for downstream consumers that still need
 * the root.
 */
export function reposRoot(): string {
  return path.join(getBytebellHome(), "repos");
}

// ── GitHub provider surface (lives in this package) ─────────────────────────
export { createPipelineRunner } from "./pipeline/run.ts";
export type { CreatePipelineRunnerDeps } from "./pipeline/run.ts";
export { createGithubIngestHandler, createLocalIngestHandler } from "./handlers/ingest-job.ts";
export type { IngestJobHandlerDeps } from "./handlers/ingest-job.ts";
export { runPull } from "./pipeline/pull.ts";
export {
  fetchLatestCommitHash,
  fetchRecentCommits,
  fetchDefaultBranch,
  fetchBranches,
  parseGithubRepo,
} from "./githubApi.ts";
export type { CommitEntry, FetchCommitsResult, ParsedRepo, DefaultBranchResult } from "./githubApi.ts";
export { bootstrapRuntime } from "./bootstrap.ts";
export type { BootstrapRuntimeOptions } from "./bootstrap.ts";
// GitHub-specific pull-source resolver (clone + diff). Provider-agnostic pull
// drivers receive this via the PullSourceResolver seam.
export { resolvePullSource } from "./pipeline/pull-source-resolver.ts";
export type { PullSourceResolution, ResolvePullSourceInput } from "./pipeline/pull-source-resolver.ts";

// ── Back-compat shim: public strategies now live in @bb/ingest-strategies ────
// Re-exported so the composition roots (OSS server, enterprise queue-bootstrap)
// keep importing these names from `@bb/ingest-github` until Phase 4 wires them
// to inject the strategy directly.
export { createFlatFolderStrategy, createConceptGraphStrategy, pickStrategy } from "@bb/ingest-strategies";
export { COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT, buildFileAnalysisUserPrompt } from "@bb/ingest-core";
// Shared phase primitives re-exported from core for existing consumers (IR).
export { classifyByTokens } from "@bb/ingest-core";
export { readScanManifest, writeScanManifest, emptyManifest } from "@bb/ingest-core";
export type { ScanManifest, ScanManifestEntry } from "@bb/ingest-core";
export { writeEligibleFiles, ELIGIBLE_FILES_RELATIVE_PATH } from "@bb/ingest-core";

// ── Back-compat shim: re-export the provider-agnostic SDK from @bb/ingest-core ─
// Existing consumers (enterprise IR, gitlab) still import these names from
// `@bb/ingest-github`. They now live in `@bb/ingest-core`; these re-exports keep
// the old import paths working until those consumers are repointed (Phase 5/6).
export {
  createLlmFileAnalyzer,
  createDiskSourceReader,
  pathsFor,
  orgsRoot,
  ensureCommitDirs,
  metaRootFor,
  businessContextDir,
  orgRegistryDir,
  encodeMetaPath,
  decodeMetaPath,
  materialiseEndpoints,
  computePullDiff,
  nullProgressContextFactory,
  dbProgressContextFactory,
  markCancelled,
  clearCancellation,
  isCancelled,
  throwIfCancelled,
  CancellationError,
  withConcurrency,
  runInPool,
  classifyFailure,
  makeSkipDecider,
  buildEffectiveIgnoreSets,
  FALLBACK_LANGUAGE,
  emptyFileAnalysis,
  languageFromPath,
  shapeAnalysis,
  preflightPull,
  transitionState,
  emptyPullSummary,
  recordPullCommit,
  throwPullFailure,
  resolveOrgId,
  ignoreSetsFromPayload,
  llmCallContextFromPayload,
  unitsLlmCallContextFromPayload,
  withUsageMeter,
} from "@bb/ingest-core";
export type {
  RepoLocation,
  IngestRunnerDeps,
  IngestRunnerInput,
  IngestStrategy,
  StrategyInput,
  StrategyResult,
  StrategyContext,
  FileAnalyzer,
  AnalyzedFileResult,
  ScanEntry,
  ScannedFile,
  OversizedFile,
  ScanDeps,
  SourceReader,
  ArchiveSink,
  ArchiveSinkInput,
  SourceFactory,
  SourceFactoryInput,
  SourceFactoryResult,
  PullFactory,
  PullFactoryInput,
  PullFactoryResult,
  PipelineSummary,
  DiffResult,
  RenamedFile,
  CondensedFileAnalysis,
  ProgressContext,
  ProgressContextFactory,
  ProgressPhase,
  ProgressReporter,
  ProgressReporterInput,
  ProgressTotalMode,
  ConcurrencyLimiter,
  EffectiveIgnoreSets,
  MetaPaths,
  ChunkAnalysisResult,
  FileChunk,
  SkipDecider,
  PullPreflight,
  PullFailureDeps,
} from "@bb/ingest-core";
