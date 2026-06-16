# `@bb/ingest-core/src/phases`

The shared analysis phases reused by every strategy (`flat-folder`,
`concept-graph`, `intermediate-representation`). Each phase has explicit
inputs/outputs, persists its artifacts to disk before yielding, and is
independently retryable — a crash resumes cleanly from the next phase boundary.
Every LLM call checks out from the shared `ConcurrencyLimiter` threaded in by
the caller, and `throwIfCancelled(knowledgeId)` runs at phase boundaries.

## Files

- `scan-and-classify.ts` — **Phase 1**. `scanAndClassify(input)` walks the
  source through `source.scan({ skipDecider, limiter })`, tokenises each file,
  classifies it as `small` / `big` / `oversized`, and writes the canonical
  `scan-manifest.json` (plus the legacy `bigFiles.json`). When a `limiter` is
  supplied, scan runs its two-pass strategy: cache-only static decisions first,
  then parallel-deduplicated LLM resolution for unknown extensions/filenames.
  Honours the per-job `EffectiveIgnoreSets` for both directory-walk pruning and
  the skip-decider's static checks.
- `analyse-small.ts` — **Phase 2a**. `analyseSmallFiles(input)` consumes the
  manifest's `kind: "small"` entries, re-opens content through the
  `SourceReader`, runs the LLM `FileAnalyzer` per file under the shared limiter
  (one retry on transient failure via `retryLlmCall`), and writes
  `CondensedFileAnalysis` JSON. Also writes oversized stubs. Returns billable
  vs. cache-served token usage separately.
- `analyse-big-files.ts` — **Phase 2b** (manifest-driven). `analyseBigFiles(input)`
  is a chunk-task queue across every `kind: "big"` manifest entry: each chunk is
  an independent task on the shared limiter, and per-file condense is scheduled
  as soon as that file's last chunk lands. Runs concurrently with 2a.
- `process-big-files.ts` — the **legacy** big-file driver
  (`processBigFilesQueue`) plus the `describe` helper. Reads the deprecated
  `bigFiles.json` and processes each entry serially via `processBigFile`
  (chunk-then-condense). Kept for the pull-path and any caller not yet migrated
  to `analyseBigFiles(manifest, …)`.
- `analyse-small.test.ts` — unit coverage for the small-file phase.

## Public interface

Re-exported from the package barrel (`#src/index.ts`):
`scanAndClassify` / `ScanAndClassifyInput` / `ScanAndClassifyResult`,
`analyseSmallFiles` / `AnalyseSmallInput` / `AnalyseSmallResult`,
`analyseBigFiles` / `AnalyseBigFilesInput`,
`processBigFilesQueue` / `ProcessBigFilesInput` / `ProcessBigFilesResult`.

## Imports allowed

- Down/within package: `#src/types/*`, `#src/pipeline/*`, `#src/big-file/*`,
  `#src/analyse-file.ts`, `#src/scan-manifest.ts`, `#src/progress/types.ts`.
- Up: `@bb/types`, `@bb/config`, `@bb/llm`, `@bb/logger`, `@bb/errors`,
  `node:*`.
- No phase imports a strategy or a provider.

## Invariants

- Disk is the inter-phase contract — no phase keeps state in memory past its
  end-of-phase write.
- LLM failures fall back to empty analyses / deterministic stubs; a per-file LLM
  error never aborts the run.
- `llmCallContext` (per-job credentials) threads through every phase into the
  underlying `askJsonLLM` call; absent, it falls back to config defaults.
- Token usage is reported split into billable and cache-served buckets so the
  runner can meter correctly.
