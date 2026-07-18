# `@bb/ingest-core/src/pipeline`

The provider-agnostic **primitives** the runner shell and every strategy build
on. Nothing here knows about a specific provider or strategy — these are the
reusable mechanics of scanning, diffing, concurrency, cancellation, and the
pull lifecycle.

## Files

- `concurrency.ts` — `withConcurrency`, `runInPool`, and the `ConcurrencyLimiter`
  type. The single knob bounding total in-flight LLM concurrency across a job.
- `cancellation.ts` — cooperative cancellation: `markCancelled`,
  `clearCancellation`, `isCancelled`, `throwIfCancelled`, and `CancellationError`
  (re-thrown past the strategy boundary so the orchestrator clears the flag
  without setting FAILED state).
- `failure-classifier.ts` — `classifyFailure` / `isRetryable` + `ClassifiedFailure`:
  maps an error to a retryable/terminal category for the runner.
- `context.ts` — payload-context helpers: `resolveOrgId`,
  `ignoreSetsFromPayload`, `llmCallContextFromPayload`,
  `unitsLlmCallContextFromPayload`, `withUsageMeter`.
- `paths.ts` — on-disk layout: `orgsRoot`, `pathsFor`, `ensureCommitDirs`,
  `metaRootFor`, `businessContextDir`, `orgRegistryDir`, `encodeMetaPath`,
  `decodeMetaPath`, and the `RepoLocation` type.
- `disk-source-reader.ts` — `createDiskSourceReader`: the OSS-default
  `SourceReader` backed by a cloned tree on disk.
- `scan.ts` / `scan-twopass.ts` / `scan-helpers.ts` — `scanRepository`,
  `readScannedFile`, `decisionKey`, `countLines`, and the repository walk used by
  phase 1. `scan.ts` holds the inline walk; `scan-twopass.ts` the parallel
  two-pass walk (split out for the file-size rule); `scan-helpers.ts` the shared
  `ScanRepositoryDeps` / counts / limits.
- `ignored-files.ts` — `makeIgnoreSink`, `IGNORED_FILES_COLLECTION`,
  `IgnoreReason`. Records every file the scan skips — and why (`ignore_dir` /
  `ignore_filename` / `ignore_extension` / `ignore_glob` / `binary` / `llm`) —
  into the `ignored_files` Mongo collection, keyed `(orgId, knowledgeId,
  filePath)`, via a single batched `bulkWrite` at end of scan. Connection comes
  from `@bb/mongo` (`getMongoDb`); the collection shape + write logic live here.
  No-op unless the caller threads `knowledgeId` + `orgId` through `ScanDeps`;
  fail-open so a Mongo error never aborts the scan.
- `filters.ts` — the legacy default ignore sets (`SKIP_DIRS`, `SKIP_FILES`,
  `BINARY_EXTENSIONS`), `looksBinary`, `passesPathFilters`. Owns the built-in
  defaults that `skip-decisions/effective.ts` merges into the effective sets.
- `affected-folders.ts` — `affectedFoldersFromDiff` for the pull path.
- `git-diff.ts` — git plumbing: `diffCommits`, `parseDiffOutput`,
  `ensureCommitReachable`, `assertReachableFromBranch`, `mergeBaseOf`,
  `deepenClone`, `checkoutCommit`, `emptyDiff`, plus the `DiffResult` /
  `RenamedFile` / `DiffStatus` types.
- `pull-diff-resolver.ts` — `materialiseEndpoints`, `computePullDiff`,
  `unionDiff`: resolve what changed between two pull endpoints.
- `pull-preflight.ts`, `pull-helpers.ts`, `pull-failure.ts`, `run-helpers.ts` —
  the pull/run lifecycle: `preflightPull`, `transitionState`,
  `emptyPullSummary`, `recordPullCommit`, `throwPullFailure`, `persistFailure`,
  `persistHalted`, `markNonRetryable`, `isGithubPayload`. `throwPullFailure`'s
  `PullFailureDeps` carries an optional `onAutoPullUsageLimit` hook: on an
  auto-pull (`isAutoPull`) failure classified `usage_limit_exceeded`, it fires
  the hook (best-effort, under `.catch()`) before preserving PROCESSED, so the
  multi-tenant wrapper can disable auto-pull for the maxed-out account. OSS
  standalone (single-tenant, no sweep) leaves it undefined.
- `retry-llm.ts` — `retryLlmCall`, `MAX_LLM_ATTEMPTS`, `RETRY_BACKOFF_MS`: the
  bounded-retry wrapper every phase uses around an LLM call.
- `stats.ts` — naming/describe helpers: `repoNameFromUrl`, `localRepoName`,
  `describe`.
- `skip-decisions/` — the LLM-backed file-inclusion gate (static blocklists +
  cached LLM verdicts + per-job effective ignore sets). See
  `skip-decisions/README.md`.
- `*.test.ts` — unit coverage (`context.test.ts`).

## Public interface

All consumer-facing symbols are re-exported from the package barrel
(`#src/index.ts`) under the "Paths", "Concurrency / cancellation / failure
classification", "Payload context", "Source reading / scan", "Git diff /
pull-diff resolution", "Pull lifecycle", "LLM retry", "Skip decisions", and
"Naming / describe helpers" sections.

## Imports allowed

- Within package: `#src/types/*`, `#src/progress/types.ts`, sibling files, and
  the `skip-decisions/` subfolder.
- Up: `@bb/types`, `@bb/config`, `@bb/llm`, `@bb/logger`, `@bb/errors`,
  `node:*`.
- No primitive imports a strategy, a provider, or a phase.

## Invariants

- Cancellation is cooperative and keyed by `knowledgeId`; `CancellationError`
  always propagates past the strategy boundary.
- One shared `ConcurrencyLimiter` per job bounds all LLM concurrency.
- The effective ignore sets used by `scan.ts` (walk pruning) and the
  skip-decider must be the identical set, so index and pull filter the same way.
- The `ignored_files` collection is an **audit trail only** — the scan drops
  ignored files regardless; nothing downstream reads this collection. Its write
  is best-effort (fail-open) and never gates or alters the scan result.
