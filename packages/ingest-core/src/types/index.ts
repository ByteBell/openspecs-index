export type { IngestStrategy, StrategyInput, StrategyResult, StrategyContext } from "./strategy.ts";
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
} from "./pipeline.ts";
export type { MetaPaths } from "./meta-paths.ts";
export type { CondensedFileAnalysis } from "./condensed-file-analysis.ts";
export type { BigFileEntry, BigFileReason, FileChunk, ChunkAnalysisResult, HugeFileManifest } from "./big-file.ts";
export { FALLBACK_LANGUAGE, emptyFileAnalysis } from "./file-analysis.ts";
export type { IngestRunnerDeps, IngestRunnerInput } from "./ingest-runner.ts";
