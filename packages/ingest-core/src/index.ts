// @bb/ingest-core — provider-agnostic ingestion SDK.
//
// Holds the pipeline contracts (IngestStrategy, SourceReader, MetaPaths, …),
// the provider-agnostic primitives, and the shared analysis phases that
// strategies and providers build on. A strategy depends ONLY on this package
// and a SourceReader — it never imports a provider (github / gitlab /
// bitbucket), and providers never import a strategy.
//
// This file is the single public entry point. Internal modules import each
// other via `#src/...`; external packages import named symbols from here.

// ── Contracts & types ──────────────────────────────────────────────────────
export type { IngestStrategy, StrategyInput, StrategyResult, StrategyContext } from "#src/types/strategy.ts";
export type {
  ScannedFile,
  OversizedFile,
  ScanEntry,
  FileAnalyzer,
  AnalyzedFileResult,
  PipelineDeps,
  PipelineSummary,
  SkipDecider,
  SkipDeciderInput,
  SkipDecision,
  SourceReader,
  ScanDeps,
  ArchiveSink,
  ArchiveSinkInput,
  SourceFactory,
  SourceFactoryInput,
  SourceFactoryResult,
  PullFactory,
  PullFactoryInput,
  PullFactoryResult,
} from "#src/types/pipeline.ts";
export type { MetaPaths } from "#src/types/meta-paths.ts";
export type { CondensedFileAnalysis } from "#src/types/condensed-file-analysis.ts";
export type {
  BigFileEntry,
  BigFileReason,
  FileChunk,
  ChunkAnalysisResult,
  HugeFileManifest,
} from "#src/types/big-file.ts";
export { FALLBACK_LANGUAGE, emptyFileAnalysis } from "#src/types/file-analysis.ts";
export type { IngestRunnerDeps, IngestRunnerInput } from "#src/types/ingest-runner.ts";
export type { TokenUsage, TokenAccumulator } from "#src/types/token-usage.ts";
export { ZERO_USAGE, addUsage, subUsage, createTokenAccumulator } from "#src/types/token-usage.ts";
export type {
  PullSourceResolution,
  ResolvePullSourceInput,
  PullSourceResolver,
  PullRunner,
} from "#src/types/pull-runner.ts";
export type { ResolveIndexSourceInput, IndexSourceResolution, IndexSourceResolver } from "#src/types/index-source.ts";

// ── Paths ──────────────────────────────────────────────────────────────────
export {
  orgsRoot,
  pathsFor,
  ensureCommitDirs,
  metaRootFor,
  businessContextDir,
  orgRegistryDir,
  encodeMetaPath,
  decodeMetaPath,
  metaId,
} from "#src/pipeline/paths.ts";
export type { RepoLocation } from "#src/pipeline/paths.ts";

// ── Concurrency / cancellation / failure classification ────────────────────
export { withConcurrency, runInPool } from "#src/pipeline/concurrency.ts";
export type { ConcurrencyLimiter } from "#src/pipeline/concurrency.ts";
export {
  markCancelled,
  clearCancellation,
  isCancelled,
  throwIfCancelled,
  CancellationError,
} from "#src/pipeline/cancellation.ts";
export { classifyFailure, isRetryable } from "#src/pipeline/failure-classifier.ts";
export type { ClassifiedFailure } from "#src/pipeline/failure-classifier.ts";

// ── Payload context ────────────────────────────────────────────────────────
export {
  resolveOrgId,
  ignoreSetsFromPayload,
  llmCallContextFromPayload,
  unitsLlmCallContextFromPayload,
  withUsageMeter,
} from "#src/pipeline/context.ts";

// ── Source reading / scan ──────────────────────────────────────────────────
export { createDiskSourceReader } from "#src/pipeline/disk-source-reader.ts";
export type { DiskSourceReaderDeps } from "#src/pipeline/disk-source-reader.ts";
export { readScannedFile } from "#src/pipeline/scan.ts";
export type { ScanRepositoryDeps } from "#src/pipeline/scan.ts";
export { decisionKey, countLines } from "#src/pipeline/scan-helpers.ts";
export { SKIP_DIRS, SKIP_FILES, BINARY_EXTENSIONS, looksBinary, passesPathFilters } from "#src/pipeline/filters.ts";
// `directFolderOf` is re-exported from #src/folder-path.ts (identical helper).
export { affectedFoldersFromDiff } from "#src/pipeline/affected-folders.ts";

// ── Git diff / pull-diff resolution ────────────────────────────────────────
export type { DiffResult, RenamedFile, DiffStatus } from "#src/pipeline/git-diff.ts";
export {
  emptyDiff,
  diffCommits,
  parseDiffOutput,
  ensureCommitReachable,
  assertReachableFromBranch,
  mergeBaseOf,
  deepenClone,
  checkoutCommit,
} from "#src/pipeline/git-diff.ts";
export { materialiseEndpoints, computePullDiff, unionDiff } from "#src/pipeline/pull-diff-resolver.ts";

// ── Pull lifecycle ─────────────────────────────────────────────────────────
export { preflightPull } from "#src/pipeline/pull-preflight.ts";
export type { PullPreflight } from "#src/pipeline/pull-preflight.ts";
export {
  transitionState,
  emptyPullSummary,
  recordPullCommit,
  recordKnowledgeBranch,
  recordKnowledgeCommitHead,
} from "#src/pipeline/pull-helpers.ts";
export { throwPullFailure } from "#src/pipeline/pull-failure.ts";
export type { PullFailureDeps } from "#src/pipeline/pull-failure.ts";
export { persistFailure, persistHalted, markNonRetryable, isGithubPayload } from "#src/pipeline/run-helpers.ts";

// ── LLM retry ──────────────────────────────────────────────────────────────
export { retryLlmCall, MAX_LLM_ATTEMPTS, RETRY_BACKOFF_MS } from "#src/pipeline/retry-llm.ts";
export type { RetryLlmCallOptions } from "#src/pipeline/retry-llm.ts";

// ── Skip decisions ─────────────────────────────────────────────────────────
export {
  makeSkipDecider,
  repositoryNameFromRepoDir,
  defaultCachePath,
  emptyCache,
  loadCache,
  saveCache,
  setExtensionDecision,
  setFilenameDecision,
  logCacheSummary,
  SKIP_DECISION_SYSTEM_PROMPT,
  buildSkipDecisionUserPrompt,
  SEED_DIRECTORIES,
  SEED_FILENAMES,
  SEED_EXTENSIONS,
  SEED_GLOBS,
  KNOWN_LANGUAGE_EXTENSIONS,
  matchesAnyGlob,
} from "#src/pipeline/skip-decisions/index.ts";
export type { SkipDeciderDeps, DecisionEntry, DecisionsCache } from "#src/pipeline/skip-decisions/index.ts";
export { buildEffectiveIgnoreSets, defaultIgnorePatternLists } from "#src/pipeline/skip-decisions/effective.ts";
export type { EffectiveIgnoreSets } from "#src/pipeline/skip-decisions/effective.ts";

// ── Progress reporting ─────────────────────────────────────────────────────
export type {
  ProgressContext,
  ProgressContextFactory,
  ProgressPhase,
  ProgressReporter,
  ProgressReporterInput,
  ProgressTotalMode,
} from "#src/progress/types.ts";
export { nullProgressContextFactory } from "#src/progress/NullProgressReporter.ts";
export { dbProgressContextFactory } from "#src/progress/DbProgressReporter.ts";

// ── LLM file analyzer adapter ──────────────────────────────────────────────
export { createLlmFileAnalyzer, shapeAnalysis, languageFromPath } from "#src/adapters/llm-file-analyzer.ts";
export type { LlmFileAnalyzerDeps } from "#src/adapters/llm-file-analyzer.ts";

// ── Naming / describe helpers ──────────────────────────────────────────────
export { repoNameFromUrl, localRepoName, describe } from "#src/pipeline/stats.ts";

// ── Shared analysis phases (reused by every strategy) ──────────────────────
export { scanAndClassify } from "#src/phases/scan-and-classify.ts";
export type { ScanAndClassifyInput, ScanAndClassifyResult } from "#src/phases/scan-and-classify.ts";
export { analyseSmallFiles } from "#src/phases/analyse-small.ts";
export type { AnalyseSmallInput, AnalyseSmallResult } from "#src/phases/analyse-small.ts";
export { analyseBigFiles } from "#src/phases/analyse-big-files.ts";
export type { AnalyseBigFilesInput } from "#src/phases/analyse-big-files.ts";
export { backfillMissingFields } from "#src/backfill/fields.ts";
export { FileAnalysisCache } from "#src/file-analysis-cache.ts";
export { analyseScannedFile, buildOversizedStub } from "#src/analyse-file.ts";
export { directFolderOf, affectedFolderPaths } from "#src/folder-path.ts";
export { readScanManifest, writeScanManifest, emptyManifest } from "#src/scan-manifest.ts";
export {
  buildPathMap,
  writePathMap,
  readPathMap,
  pathMapPath,
  PATH_MAP_RELATIVE_PATH,
  PATH_MAP_SCHEMA_VERSION,
} from "#src/path-map.ts";
export type { PathMap } from "#src/path-map.ts";
export type { ScanManifest, ScanManifestEntry, ScanManifestSummary, ScanEntryKind } from "#src/scan-manifest.ts";
export { writeEligibleFiles, ELIGIBLE_FILES_RELATIVE_PATH } from "#src/eligible-files.ts";
export type { EligibleFilesDocument, WriteEligibleFilesInput } from "#src/eligible-files.ts";
export {
  classifyByTokens,
  buildBigFileEntry,
  readBigFiles,
  writeBigFiles,
  appendBigFileEntry,
} from "#src/big-file/detector.ts";
export {
  saveChunk,
  loadChunkIfPresent,
  saveManifest,
  readManifestIfPresent,
  saveCondensed,
  readCondensed,
} from "#src/big-file/storage.ts";
export { processBigFile } from "#src/big-file/index.ts";
export type { ProcessBigFileInput } from "#src/big-file/index.ts";
export { processBigFilesQueue } from "#src/phases/process-big-files.ts";
export type { ProcessBigFilesInput, ProcessBigFilesResult } from "#src/phases/process-big-files.ts";

// ── Shared analysis prompts ────────────────────────────────────────────────
export { COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT, buildFileAnalysisUserPrompt } from "#src/prompts/file-analysis.ts";
export { FILE_ANALYSIS_FIELDS_BLOCK } from "#src/prompts/file-analysis-fields.ts";
export { BACKFILL_SYSTEM_PROMPT, buildBackfillUserPrompt } from "#src/prompts/backfill.ts";
export { CHUNK_ANALYSIS_SYSTEM_PROMPT, buildChunkUserPrompt } from "#src/prompts/chunk.ts";
export { CONDENSE_SYSTEM_PROMPT, buildCondenseUserPrompt } from "#src/prompts/condense.ts";
