# `ingest-github / progress`

**Tier:** Domain extension port

## Responsibility

Defines the host-binary extension port for observing ingestion-phase progress without coupling `@bb/ingest-github` to any transport.

The strategy emits two kinds of signals through this port:

- **Intra-phase ticks** via `ProgressReporter` — one reporter per phase or sub-phase of one job, driven by the strategy as it makes progress.
- **Phase boundaries and terminal state** via `ProgressContext.phaseChanged / completed / failed`.

A host binary may supply a `ProgressContextFactory(knowledgeId)`. When none is passed, `@bb/ingest-github` defaults to `dbProgressContextFactory` (persists phase-weighted progress to the knowledge `status` — see `phaseWeights.ts` below); `nullProgressContextFactory` discards every signal and is used where progress is irrelevant (e.g. some pull paths).

## Public API

- `ProgressPhase` — `"clone" | "scan" | "file_analysis" | "folder_analysis" | "indexing" | "enrichment"`. `clone` and `scan` are emitted by `runGithub` (the runner) before the strategy starts, so SSE clients see liveness during the network/disk-bound prelude. `file_analysis`, `folder_analysis`, `indexing`, and `enrichment` are emitted by the strategy (flat-folder uses `folder_analysis`+`indexing`; concept-graph uses `indexing`+`enrichment`).
- `ProgressTotalMode` — `{ kind: "fixed"; total }` or `{ kind: "growing"; initialTotal? }`
- `ProgressReporterInput` — phase + sub-phase + total mode + optional restart-seed hook
- `ProgressReporter` — `start / increment / incrementSeen / setTotal / stop`
- `ProgressContext` — bundles `reporter()` with boundary-event publishers
- `ProgressContextFactory` — `(knowledgeId) => ProgressContext`
- `nullProgressContextFactory` — no-op fallback used when the host does not supply one
- `phaseWeights.ts` — `phaseFloorPercent(phase)` and `fileAnalysisPercent(processed, total)` map phases onto a monotonic 0–100 scale so the bar does not hit 100% when file analysis ends; later phases (folder/indexing/enrichment) step to their floors. `DbProgressReporter` (the `dbProgressContextFactory` the server wires in) persists this percent plus the current phase onto the knowledge `status` via `updateKnowledgeProgress`, which `GET /api/v1/repos/:id` then surfaces.

## Invariants

- Pure types and a no-op default. No transport. No outbound calls.
- Tracker decisions (sampling cadence, persistence, fanout) belong to the host implementation.
- The strategy must call `reporter.stop()` in a `finally` so the host can emit a final tick deterministically.
- Reporters returned for the same `(knowledgeId, phase, subPhase)` are not reused across invocations — each `reporter()` call returns a fresh instance.

## External dependencies

None.
