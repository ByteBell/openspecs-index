// @bb/ingest-strategies — the public ingestion strategies.
//
// Provider-agnostic strategies built on @bb/ingest-core. Each strategy only
// needs a SourceReader (a source folder) and the shared phases from core; it
// never imports a provider (github / gitlab / bitbucket).
//
//   - flat-folder    : per-file analysis + folder/repo summaries (default)
//   - concept-graph  : per-file analysis + MCP hypergraph enrichment
//
// The private `intermediate-representation` strategy lives in the enterprise
// `@bytebell/ingest-strategies` package, not here.

export { createFlatFolderStrategy } from "#src/flat-folder/index.ts";
export type { FlatFolderStrategyDeps } from "#src/flat-folder/index.ts";
export { createConceptGraphStrategy } from "#src/concept-graph/index.ts";
export type { ConceptGraphStrategyDeps } from "#src/concept-graph/index.ts";
export { pickStrategy } from "#src/pickStrategy.ts";
export type { PickStrategyDeps } from "#src/pickStrategy.ts";

// Flat-folder pull-driver phases. Surfaced so the GitHub flat-folder pull
// driver (`@bb/ingest-github`'s runPull, until Phase 4 moves it here) can reuse
// the changed-file analysis + selective summary + store steps.
export { analyseChangedFiles } from "#src/flat-folder/analyse-changed.ts";
export type { AnalyseChangedInput, AnalyseChangedResult } from "#src/flat-folder/analyse-changed.ts";
export { runSelectiveFolderSummary } from "#src/flat-folder/folder-summary-selective.ts";
export type {
  SelectiveFolderSummaryInput,
  SelectiveFolderSummaryResult,
} from "#src/flat-folder/folder-summary-selective.ts";
export { summariseRepo, persistRepoSummary, makeRepoSummaryEnvelope } from "#src/flat-folder/repo-summary.ts";
export { storePullAnalysis } from "#src/flat-folder/store-pull.ts";
export type { StorePullInput, StorePullResult } from "#src/flat-folder/store-pull.ts";
