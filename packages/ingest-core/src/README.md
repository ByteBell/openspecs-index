# `@bb/ingest-core/src`

Source root for the provider-agnostic ingestion SDK. `index.ts` is the **single
public entry point**: every contract, primitive, shared phase, and prompt a
strategy or provider may consume is re-exported from here. Internal modules
import each other via `#src/...`; external packages import named symbols from
the package barrel only.

## Layout

- `index.ts` — the package barrel. Groups its re-exports by concern: contracts &
  types, paths, concurrency/cancellation/failure-classification, payload
  context, source reading & scan, git-diff & pull-diff resolution, pull
  lifecycle, LLM retry, skip-decisions, progress reporting, the LLM file
  analyzer adapter, naming helpers, the shared analysis phases, and the shared
  analysis prompts.
- `types/` — the contracts (`IngestStrategy`, `StrategyInput`/`Result`/`Context`,
  `SourceReader`, `ArchiveSink`, `MetaPaths`, `SourceFactory`/`PullFactory`,
  `PullSourceResolver`, `IndexRunner`, token-usage helpers). See
  `types/README.md`.
- `pipeline/` — the provider-agnostic primitives (concurrency, cancellation,
  failure classification, payload context, paths, git-diff, pull-diff
  resolution, the disk source reader, scan, skip-decisions, pull lifecycle
  helpers, stats). See `pipeline/README.md`.
- `phases/` — the shared analysis phases reused by every strategy
  (scan-and-classify, analyse-small, analyse-big, process-big-files). See
  `phases/README.md`.
- `prompts/` — the per-file LLM analysis prompts (file-analysis, backfill,
  chunk, condense). See `prompts/README.md`.
- `big-file/` — chunker, analyzer, condenser, detector, storage, and cache for
  files too large for a single LLM call. See `big-file/README.md`.
- `backfill/` — the field-backfill phase that fills missing extended analysis
  fields on already-condensed entries. See `backfill/README.md`.
- `adapters/` — the LLM file-analyzer adapter that turns `@bb/llm` calls into a
  `FileAnalyzer`. See `adapters/README.md`.
- `progress/` — the `ProgressContext` port plus the null and DB-backed
  reporters. See `progress/README.md`.
- Root files — `analyse-file.ts` (`analyseScannedFile`, `buildOversizedStub`),
  `file-analysis-cache.ts`, `folder-path.ts`, `scan-manifest.ts`, and
  `eligible-files.ts`: the shared single-file analysis primitive, the in-memory
  condensed-analysis cache, folder-path helpers, the canonical scan-manifest
  reader/writer, and the eligible-files artifact writer.

## Dependency direction

Everything points **inward to core**: `core ← ingest-github`,
`core ← ingest-strategies`, `core ← ingest-gitlab`,
`core ← downstream private strategy packages`. This package imports **no** strategy and
**no** provider — only `@bb/*` infrastructure (`@bb/types`, `@bb/config`,
`@bb/llm`, `@bb/logger`, `@bb/errors`, …) and `node:*`.

## Invariants

- `index.ts` is the only cross-package import surface; reaching into a subfolder
  from outside the package is forbidden.
- A strategy depends only on this package and a `SourceReader` — it never knows
  whether the source came from GitHub, GitLab, or Bitbucket.
- All source-tree access flows through the `SourceReader` port; no module here
  reads the working tree directly outside the disk reader.

Tier: **strategy / orchestration foundation** (the shared base below every
strategy and provider).
