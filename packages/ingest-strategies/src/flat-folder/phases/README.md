# `@bb/ingest-github/src/strategies/flat-folder/phases`

The main-line phases of the flat-folder strategy. Each file is one phase
entry point invoked by `createFlatFolderStrategy` in execution order.
Backfill (Phases 3 and 4) lives in the sibling `backfill/` folder; folder
and repo summarisation (Phases 5 and 6) live as `folder-summary.ts` and
`repo-summary.ts` at the strategy root.

The strategy constructs a **shared LLM limiter** (`withConcurrency(Config.LlmConcurrency)`,
default 29) once at entry. Every LLM call across the small-file phase,
the big-file chunk phase, and per-file condense calls checks out from
the same pool — the single tunable for total in-flight LLM calls.

## Files

- `scan-and-classify.ts` — Phase 1. `scanAndClassify({knowledgeId, source,
metaPaths, skipDecider?, llmCallContext?, progressContext?})` walks
  `source.scan({ skipDecider, llmCallContext })` exactly once, counts
  tokens for every eligible entry, classifies each as `"small"`,
  `"big"` (token count > `Config.ContextWindowLimit`), or `"oversized"`
  (yielded as `kind === "oversized"` by `scanRepository`), and writes
  `meta-output/scan-manifest.json` plus the legacy `bigFiles.json` (for
  pull-path and backfill consumers that have not migrated). Big entries
  get a cheap `estimatedChunks = ceil(tokenCount / Config.MaxTokensPerChunk)`
  used by Phase 2's progress reporter. No LLM calls. No file analysis.
- `analyse-small.ts` — Phase 2a. `analyseSmallFiles({knowledgeId, manifest,
source, metaPaths, analyzer, limiter, archiveSink?, llmCallContext?,
progressContext?})` filters the manifest to `kind === "small"` entries,
  re-reads each file via `source.readFile`, runs the LLM file analyser,
  and persists via `saveCondensed`. Oversized entries also flow through
  here as stub writes (no LLM). Every LLM dispatch goes through the
  shared `limiter`. Progress is a fixed total — `smallCount + oversizedCount`.
- `process-big-files.ts` — Phase 2b plus the legacy queue. Exports two
  functions:
  - `analyseBigFiles({knowledgeId, manifest, source, metaPaths, limiter,
llmCallContext?, progressContext?})` — manifest-driven chunk-task
    queue. Skips files already complete (manifest + condensed on disk).
    For each remaining big file: read content, split into chunks
    via `splitFileIntoChunks`, register a per-file `pendingChunks`
    counter. Every chunk becomes an independent task scheduled through
    the shared limiter: cache-check via `loadChunkIfPresent`, otherwise
    `analyzeChunk` + `saveChunk`. When a file's last chunk lands, that
    file's condense is **immediately** scheduled through the same
    limiter — condenses across multiple files run in parallel with
    chunks of slower files. Two fixed-total progress sub-phases:
    `"big_files_chunks"` (sum of `estimatedChunks`) and
    `"big_files_condense"` (`bigCount`).
  - `processBigFilesQueue({knowledgeId, source, metaPaths, llmCallContext?,
progressContext?})` — legacy serial driver kept for the pull-path
    (`pipeline/pull.ts`) and any caller that has not migrated to
    `analyseBigFiles(manifest, …)`. Reads `bigFiles.json`, dispatches
    `processBigFile` once per file in a `for` loop.
- `store-flat-analysis.ts` — Phase 7.
  `storeFlatAnalysis({scope, payload, branch, metaPaths, cache})` ensures
  `flat-folder` Neo4j indexes, upserts `:Repo` (from `repo-summary.json`
  if present, empty payload otherwise), then **dispatches `:Folder` and
  `:File` upserts in batches of `Config.Neo4jBatchSize` (default 50)**
  via `upsertFolderNodesBatch` / `upsertFileNodesBatch` from `@bb/neo4j`.
  Each batch is one Neo4j write transaction containing the same 12
  Cyphers (1 MERGE + 1 folder-attach + 5 rel CLEARs + 5 rel ATTACHes via
  UNWIND) that a single upsert used to issue — so a 1 000-file repo
  collapses from ~12 000 round-trips to ~240. Files whose containing
  folder was not in the summaries set get a synthesised empty `:Folder`
  entry added to the folder batch list **up front** (before any batch
  dispatches) so the `CONTAINS` edge always lands.
  `languageFromPath` fills `language` when the analysis left it blank.
  Both progress reporters (`folders`, `files`) open at phase entry with
  their fixed totals so the indexing overall-progress aggregate sees
  both denominators from the first tick — fixes the prior "leaps to 100
  then sits there" UX bug.

## Execution order

```
scanAndClassify
        ↓ (manifest in-memory + on disk)
┌── analyseSmallFiles ──┐
│                       │  (Promise.all, share one limiter)
└── analyseBigFiles ────┘
        ↓
FileAnalysisCache.loadAll  (one parallel readdir+readFile pass)
        ↓
backfillMissingFields → folderSummary → repoSummary → storeFlatAnalysis
   (cache read+write)     (cache read)                 (cache read)
```

`FileAnalysisCache` is a `Map<relativePath, CondensedFileAnalysis>` loaded
once between phase 2 and phase 3. Phases 3, 5, 7 all consume the same
instance — phase 3 also calls `cache.set(...)` after each backfill write
so phases 5 and 7 see the updated entries without re-reading disk.

## Public interfaces

- `scanAndClassify(input): Promise<ScanAndClassifyResult>` —
  `{ manifest }`. The manifest contains every eligible file plus a
  `summary` with `totalFiles`, `smallCount`, `bigCount`, `oversizedCount`,
  `totalTokens`, `estimatedBigChunks`.
- `analyseSmallFiles(input): Promise<AnalyseSmallResult>` —
  `{ smallFilesAnalysed, oversizedStubs, failed, tokenUsage }`.
  Progress: fixed-total reporter sized by `smallCount + oversizedCount`.
- `analyseBigFiles(input): Promise<ProcessBigFilesResult>` —
  `{ processed, cached, failed, skippedOversized, tokenUsage }`.
  Progress: two fixed-total reporters — one for chunks across all
  big files, one for per-file condenses.
- `processBigFilesQueue(input): Promise<ProcessBigFilesResult>` — same
  result shape; legacy driver used by the pull path.
- `storeFlatAnalysis(input): Promise<StoreFlatAnalysisResult>` —
  `{ nodesWritten, foldersWritten, filesWritten }`.

## Data ownership

- Phase 1 writes `scan-manifest.json` (canonical) and `bigFiles.json`
  (legacy view for backfill + pull). It does not write per-file
  analyses.
- Phase 2a writes condensed JSON for small files + oversized stubs.
- Phase 2b writes per-chunk JSON (`chunks/<file>/chunk-N.json`),
  per-file chunk manifests (`<file>.manifest.json`), and condensed JSON
  for big files.
- `FileAnalysisCache` is an in-memory artifact owned by the strategy
  run (not persisted). It loads from `fileAnalysisDir` once and is
  passed by reference to phases 3, 5, and 7.
- Phase 7 owns no disk artifacts. It reads on-disk state produced by
  Phases 1–6 and writes Neo4j nodes (`:Repo`, `:Folder`, `:File`) plus
  the `CONTAINS` edge.

## Invariants

- Disk is the inter-phase contract; nothing crosses a phase boundary in
  memory (except the in-memory manifest object that scan returns directly
  to the orchestrator, which is a convenience — the canonical copy on
  disk is what later resume/backfill runs read).
- `throwIfCancelled(knowledgeId)` runs at every scan boundary, every
  per-chunk and per-file dispatch boundary, and before each Neo4j
  upsert in Phase 7.
- Per-file or per-chunk LLM/I/O failures are logged and counted; phases
  do not abort on a single bad file. Only `CancellationError`,
  `LlmConfigError`, and `LlmError` propagate.
- The shared LLM limiter is the only place LLM concurrency is bounded
  during the small/big phases **and the folder-summary phase**.
  `Config.BigFileConcurrency` is no longer consulted from the chunk-queue
  path (it is still consulted by the legacy `processBigFile` used by the
  pull-path driver). `Config.ConcurrentWorkers` is no longer consulted
  by the folder-summary phase.
- Phase 5 batches small folders by default. `Config.FolderSummaryBatchSize`
  (default 10) controls batch size; set to 1 to disable and restore one
  LLM call per folder. `Config.FolderSummaryBatchMaxFiles` (default 15)
  is the per-folder file ceiling above which a folder always takes the
  individual path so the LLM still sees the full per-file context. Large
  folders run side-by-side with batches under the same shared limiter.
- Phase 1 respects `Config.ContextWindowLimit` and
  `Config.MaxTokensPerChunk`; do not hardcode either.
- Phase 7 always emits a `:Repo` node, even when `repo-summary.json` is
  absent (logged as a `phase7` warning).

## External dependencies

`@bb/llm` (`tokenLen`), `@bb/logger`, `@bb/config`, `@bb/types`
(`Config`, `GithubIndexPayload`), `@bb/neo4j` (`ensureFlatFolderIndexes`,
`upsertRepoNode`, `upsertFolderNode`, `upsertFileNode`, `NodeScope`),
`pipeline/scan.ts`, `pipeline/concurrency.ts`, `pipeline/cancellation.ts`,
and the sibling `flat-folder/{analyse-file, big-file, folder-summary,
folder-path, scan-manifest}` modules plus
`adapters/llm-file-analyzer.ts` (`languageFromPath`).

## Tier

Strategy (under the `flat-folder` domain strategy).
