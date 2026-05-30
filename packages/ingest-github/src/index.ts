import { JobType } from "@bb/types";
import { registerWorker } from "@bb/queue";
import { createPipelineRunner } from "./pipeline/run.ts";
import { reposRoot } from "./pipeline/paths.ts";
import { runPull } from "./pipeline/pull.ts";
import { createGithubIngestHandler, createLocalIngestHandler } from "./handlers/ingest-job.ts";
import { createFlatFolderStrategy } from "./strategies/flat-folder/index.ts";
import { createLlmFileAnalyzer } from "./adapters/llm-file-analyzer.ts";
import {
  COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT,
  buildFileAnalysisUserPrompt,
} from "./strategies/flat-folder/prompts/file-analysis.ts";
import type { PullFactory, SourceFactory } from "./types/pipeline.ts";
import type { ProgressContextFactory } from "./progress/types.ts";
import { nullProgressContextFactory } from "./progress/NullProgressReporter.ts";

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
  const strategy = createFlatFolderStrategy({ fileAnalyzer, progressContextFactory });
  const runnerDeps: Parameters<typeof createPipelineRunner>[0] = {
    reposRootDir: reposRoot(),
    strategy,
    progressContextFactory,
  };
  if (sourceFactory !== undefined) {
    runnerDeps.sourceFactory = sourceFactory;
  }
  return createPipelineRunner(runnerDeps);
}

export function registerGithubWorkers(deps: RegisterGithubWorkersDeps = {}): void {
  const progressContextFactory = deps.progressContextFactory ?? nullProgressContextFactory;
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
  const runner = buildRunner(undefined, nullProgressContextFactory);
  const localHandler = createLocalIngestHandler({ runner });
  registerWorker(JobType.LocalIngest, async (msg) => {
    await localHandler(msg);
  });
}

export { createFlatFolderStrategy } from "./strategies/flat-folder/index.ts";
export { createLlmFileAnalyzer, languageFromPath } from "./adapters/llm-file-analyzer.ts";
export { createDiskSourceReader } from "./pipeline/disk-source-reader.ts";
export { withConcurrency, runInPool } from "./pipeline/concurrency.ts";
export type { ConcurrencyLimiter } from "./pipeline/concurrency.ts";
export { makeSkipDecider } from "./pipeline/skip-decisions/index.ts";
export type { SkipDeciderDeps } from "./pipeline/skip-decisions/index.ts";
export { createPipelineRunner } from "./pipeline/run.ts";
export type { CreatePipelineRunnerDeps } from "./pipeline/run.ts";
export { createGithubIngestHandler, createLocalIngestHandler } from "./handlers/ingest-job.ts";
export type { IngestJobHandlerDeps } from "./handlers/ingest-job.ts";
export { runPull } from "./pipeline/pull.ts";
export {
  reposRoot,
  repoCloneDir,
  metaRootFor,
  metaPathsFor,
  commitMetaDir,
  businessContextDir,
  orgRegistryDir,
} from "./pipeline/paths.ts";
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
} from "./types/pipeline.ts";
export type { DiffResult, RenamedFile } from "./pipeline/git-diff.ts";
export { diffCommits, emptyDiff, checkoutCommit } from "./pipeline/git-diff.ts";
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

// Reconstruction-grade IR analyzer (intermediate-representation strategy). Exposed so callers
// outside the package can run the split / unit-IR / verify phases or the whole-file pipeline.
export {
  createReconstructionAnalyzer,
  type ReconstructionAnalyzer,
  type AnalyseFileInput,
  type ExtractUnitIrInput,
  type VerifyUnitInput,
  type AnalyzeUnitInput,
  type AnalyzeFileInput,
  type AnalyseFileResult,
  type UnitIrResult,
  type VerifyUnitResult,
  type UnitReconstruction,
  type FileReconstructionResult,
  type CodeUnit,
  type ModuleIr,
  type UnitDescriptor,
  type FileAnalysisResult,
  type SemanticFields,
  type EquivalenceReport,
  type UnitVerification,
  computeUnitFingerprint,
  computeModuleFingerprint,
  buildUnitId,
  analyzeFileToRecords,
  codeUnitKey,
  type AnalyzeFileToRecordsInput,
  type FileRecords,
  type FileModuleRecord,
  type CodeUnitsRecord,
  type CodeUnitEntry,
} from "./strategies/intermediate-representation/reconstruction/index.ts";

// IR big-file path (boundary-aware chunking, no condensation). Exposed so callers can chunk a
// large file, refine cuts onto declaration boundaries, and get one verbatim record per chunk.
export {
  createIrBigFileAnalyzer,
  type IrBigFileAnalyzer,
  type AnalyzeBigFileInput,
  type IrBigFileResult,
  type BigFileChunksResult,
} from "./strategies/intermediate-representation/big-file/index.ts";
export type { IrChunkRecord } from "./strategies/intermediate-representation/types.ts";

// IR ingest strategy — composes the scan / analyse-small / compute-boundaries / cut-big-files /
// analyse-big-chunks phases into one IngestStrategy. Persists per-file and per-chunk
// FileAnalysisResult records on disk; no folder/repo summary, no Neo4j writes, no reconstruction.
export { createIrStrategy, type IrStrategyDeps } from "./strategies/intermediate-representation/index.ts";
export type {
  IrFileAnalysisRecord,
  IrBigFileBoundaries,
  IrBigFileChunkRaw,
} from "./strategies/intermediate-representation/records.ts";

// IR phases — exposed so a driver can step them one at a time (each persists its output, so
// running them in order against the same MetaPaths reproduces what `createIrStrategy().execute`
// does).
export {
  scanAndClassify as irScanAndClassify,
  type ScanAndClassifyInput as IrScanAndClassifyInput,
  type ScanAndClassifyResult as IrScanAndClassifyResult,
} from "./strategies/intermediate-representation/phases/scan-and-classify.ts";
export {
  analyseSmallFiles as irAnalyseSmallFiles,
  type AnalyseSmallInput as IrAnalyseSmallInput,
  type AnalyseSmallResult as IrAnalyseSmallResult,
} from "./strategies/intermediate-representation/phases/analyse-small.ts";
export {
  computeBigFileBoundaries as irComputeBigFileBoundaries,
  type ComputeBoundariesInput as IrComputeBoundariesInput,
  type ComputeBoundariesResult as IrComputeBoundariesResult,
} from "./strategies/intermediate-representation/phases/compute-boundaries.ts";
export {
  cutBigFiles as irCutBigFiles,
  type CutBigFilesInput as IrCutBigFilesInput,
  type CutBigFilesResult as IrCutBigFilesResult,
} from "./strategies/intermediate-representation/phases/cut-big-files.ts";
export {
  analyseBigChunks as irAnalyseBigChunks,
  type AnalyseBigChunksInput as IrAnalyseBigChunksInput,
  type AnalyseBigChunksResult as IrAnalyseBigChunksResult,
} from "./strategies/intermediate-representation/phases/analyse-big-chunks.ts";

// Cross-run incremental helpers — used by drivers that replay a commit sequence outside the
// pull pipeline (e.g. benchmark replayers). The flat-folder pull path does the equivalent via
// Mongo state + `analyseChangedFiles`.
export {
  findPriorIndexedCommit,
  applyDiffInvalidation,
  logCommitDiff,
  logNoPriorCommit,
  type PriorIndexedCommit,
  type PriorIndexedCommitCandidate,
  type ApplyDiffInvalidationInput,
  type ApplyDiffInvalidationResult,
  type LogCommitDiffInput,
  type LogNoPriorCommitInput,
} from "./strategies/intermediate-representation/incremental.ts";
