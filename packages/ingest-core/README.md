# @bb/ingest-core

Provider-agnostic ingestion SDK. The shared foundation that ingestion
**strategies** and source **providers** both build on, so that:

- a strategy needs only a `SourceReader` (a source folder) and never knows about
  GitHub / GitLab / Bitbucket, and
- a provider supplies clone + source resolution and never imports a strategy.

## What lives here

- **Contracts** — `IngestStrategy`, `StrategyInput` / `StrategyResult` /
  `StrategyContext`, `SourceReader`, `ArchiveSink`, `MetaPaths`,
  `SourceFactory` / `PullFactory`, and the injection seams `PullSourceResolver`
  and `IndexRunner`.
- **Runner shell** — `createPipelineRunner` (generic; the per-provider
  `IndexRunner` is injected by the provider package).
- **Primitives** — concurrency, cancellation, failure classification, payload
  context, paths, git-diff, pull-diff resolution, the disk source reader, scan,
  skip-decisions, pull lifecycle helpers, progress reporters, and the LLM file
  analyzer adapter.
- **Shared phases** — scan-and-classify, analyse-small, analyse-big, backfill,
  file-analysis cache, scan-manifest, eligible-files, big-file handling, and the
  per-file analysis prompts. Reused by every strategy (`flat-folder`,
  `concept-graph`).

## Dependency direction

Everything points **inward to core**: `core ← ingest-github`,
`core ← ingest-strategies`, `core ← ingest-gitlab`,
`core ← downstream private strategy packages`. No package imports a strategy except the
composition roots (OSS `server`, enterprise `knowledge-server`).
