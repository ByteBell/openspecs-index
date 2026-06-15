import path from "node:path";
import { Config, JobType } from "@bb/types";
import { getBytebellHome, getConfigValue } from "@bb/config";
import { logger } from "@bb/logger";
import { registerWorker } from "@bb/queue";
import { createPipelineRunner } from "./pipeline/run.ts";
import { orgsRoot } from "./pipeline/paths.ts";
import { runPull } from "./pipeline/pull.ts";
import { createGithubIngestHandler, createLocalIngestHandler } from "./handlers/ingest-job.ts";
import { createFlatFolderStrategy } from "./strategies/flat-folder/index.ts";
import { createConceptGraphStrategy } from "./strategies/concept-graph/index.ts";
import type { IngestStrategy } from "./types/strategy.ts";
import { createLlmFileAnalyzer } from "./adapters/llm-file-analyzer.ts";
import {
  COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT,
  buildFileAnalysisUserPrompt,
} from "./strategies/flat-folder/prompts/file-analysis.ts";
import type { PullFactory, SourceFactory } from "./types/pipeline.ts";
import type { ProgressContextFactory } from "./progress/types.ts";
import { dbProgressContextFactory } from "./progress/DbProgressReporter.ts";

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

interface PickStrategyDeps {
  fileAnalyzer: Parameters<typeof createFlatFolderStrategy>[0]["fileAnalyzer"];
  progressContextFactory: ProgressContextFactory;
}

/**
 * Resolves the active ingestion strategy from `Config.IngestionStrategy`.
 * Defaults to flat-folder when the config value is unset or unrecognised
 * (with a warning so the operator knows their typo silently fell back).
 */
export function pickStrategy(deps: PickStrategyDeps): IngestStrategy {
  const selected = getConfigValue(Config.IngestionStrategy);
  switch (selected) {
    case "concept-graph":
      logger.info("ingest-github: active strategy = concept-graph");
      return createConceptGraphStrategy({
        fileAnalyzer: deps.fileAnalyzer,
        progressContextFactory: deps.progressContextFactory,
      });
    case "flat-folder":
      logger.info("ingest-github: active strategy = flat-folder");
      return createFlatFolderStrategy({
        fileAnalyzer: deps.fileAnalyzer,
        progressContextFactory: deps.progressContextFactory,
      });
    default:
      logger.warn(`ingest-github: Config.IngestionStrategy="${selected}" unrecognised; falling back to flat-folder`);
      return createFlatFolderStrategy({
        fileAnalyzer: deps.fileAnalyzer,
        progressContextFactory: deps.progressContextFactory,
      });
  }
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

export { createFlatFolderStrategy } from "./strategies/flat-folder/index.ts";
export { createConceptGraphStrategy } from "./strategies/concept-graph/index.ts";

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
export { createLlmFileAnalyzer } from "./adapters/llm-file-analyzer.ts";
export { createDiskSourceReader } from "./pipeline/disk-source-reader.ts";
export { createPipelineRunner } from "./pipeline/run.ts";
export type { CreatePipelineRunnerDeps } from "./pipeline/run.ts";
export { createGithubIngestHandler, createLocalIngestHandler } from "./handlers/ingest-job.ts";
export type { IngestJobHandlerDeps } from "./handlers/ingest-job.ts";
export { runPull } from "./pipeline/pull.ts";
// kube-v2 path resolver entry points. `pathsFor(loc)` is the pure path
// builder; the knowledgeId-keyed helpers (`metaRootFor`, `businessContextDir`,
// `orgRegistryDir`) are async — they look up `KnowledgeDoc` from Mongo to
// derive the `RepoLocation` before resolving the path.
export {
  pathsFor,
  orgsRoot,
  ensureCommitDirs,
  metaRootFor,
  businessContextDir,
  orgRegistryDir,
} from "./pipeline/paths.ts";
export type { RepoLocation } from "./pipeline/paths.ts";
export type { IngestRunnerDeps, IngestRunnerInput } from "./types/ingest-runner.ts";
export type { IngestStrategy, StrategyInput, StrategyResult, StrategyContext } from "./types/strategy.ts";
export type {
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
} from "./types/pipeline.ts";
export type { DiffResult, RenamedFile } from "./pipeline/git-diff.ts";
// Provider-agnostic pull-diff helpers (deepen a shallow clone, then diff two
// commits with a merge-base fallback). Reused by provider wrappers (e.g. GitLab)
// whose pull factory must compute the changed-file set itself.
export { materialiseEndpoints, computePullDiff } from "./pipeline/pull-diff-resolver.ts";
export type { CondensedFileAnalysis } from "./types/condensed-file-analysis.ts";
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
export {
  COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT,
  buildFileAnalysisUserPrompt,
} from "./strategies/flat-folder/prompts/file-analysis.ts";
export type {
  ProgressContext,
  ProgressContextFactory,
  ProgressPhase,
  ProgressReporter,
  ProgressReporterInput,
  ProgressTotalMode,
} from "./progress/types.ts";
export { nullProgressContextFactory } from "./progress/NullProgressReporter.ts";
export { dbProgressContextFactory } from "./progress/DbProgressReporter.ts";
// Cooperative cancellation: the pipeline polls `throwIfCancelled` at every file /
// phase boundary. A consumer (e.g. the enterprise worker) calls `markCancelled`
// when the knowledge is deleted so an in-flight job aborts at its next checkpoint.
export {
  markCancelled,
  clearCancellation,
  isCancelled,
  throwIfCancelled,
  CancellationError,
} from "./pipeline/cancellation.ts";

// ─────────────────────────────────────────────────────────────────────────────
// IR-strategy support surface. These are internal pipeline primitives surfaced
// so an out-of-tree strategy (the private `@bytebell/ingest-ir`) can reuse the
// same scan / classify / file-analysis / skip-decision building blocks without
// reaching into this package's internals. No new behaviour — re-exports only.
// ─────────────────────────────────────────────────────────────────────────────
export { withConcurrency, runInPool } from "./pipeline/concurrency.ts";
export type { ConcurrencyLimiter } from "./pipeline/concurrency.ts";
export { classifyFailure } from "./pipeline/failure-classifier.ts";
export { makeSkipDecider } from "./pipeline/skip-decisions/index.ts";
export { buildEffectiveIgnoreSets } from "./pipeline/skip-decisions/effective.ts";
export type { EffectiveIgnoreSets } from "./pipeline/skip-decisions/effective.ts";
export { encodeMetaPath, decodeMetaPath } from "./pipeline/paths.ts";
export type { MetaPaths } from "./types/meta-paths.ts";
export type { ChunkAnalysisResult, FileChunk } from "./types/big-file.ts";
export type { SkipDecider } from "./types/pipeline.ts";
export { FALLBACK_LANGUAGE, emptyFileAnalysis } from "./types/file-analysis.ts";
export { languageFromPath, shapeAnalysis } from "./adapters/llm-file-analyzer.ts";
export { classifyByTokens } from "./strategies/flat-folder/big-file/detector.ts";
export { readScanManifest, writeScanManifest, emptyManifest } from "./strategies/flat-folder/scan-manifest.ts";
export type { ScanManifest, ScanManifestEntry } from "./strategies/flat-folder/scan-manifest.ts";
export { writeEligibleFiles, ELIGIBLE_FILES_RELATIVE_PATH } from "./strategies/flat-folder/eligible-files.ts";
// Pull-prelude primitives surfaced for the out-of-tree IR pull driver
// (`@bytebell/ingest-ir`'s `runIrPull`). It reuses OSS's strategy-agnostic pull
// prelude (preflight → source/diff resolution → failure classification) and
// lifecycle writes, then swaps the flat-folder analysis phases for the IR
// strategy. Additive re-exports + the `recordPullCommit` lifecycle wrapper — no
// behaviour change to `runPull` itself.
export { preflightPull } from "./pipeline/pull-preflight.ts";
export type { PullPreflight } from "./pipeline/pull-preflight.ts";
export { resolvePullSource } from "./pipeline/pull-source-resolver.ts";
export type { PullSourceResolution, ResolvePullSourceInput } from "./pipeline/pull-source-resolver.ts";
export { transitionState, emptyPullSummary, recordPullCommit } from "./pipeline/pull-helpers.ts";
export { throwPullFailure } from "./pipeline/pull-failure.ts";
export type { PullFailureDeps } from "./pipeline/pull-failure.ts";
export {
  resolveOrgId,
  ignoreSetsFromPayload,
  llmCallContextFromPayload,
  unitsLlmCallContextFromPayload,
  withUsageMeter,
} from "./pipeline/context.ts";
