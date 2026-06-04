# Intermediate Representation — full working

This folder is one of ByteBell's ingestion **strategies**. A strategy is "the recipe for
turning a freshly-cloned repo into something a machine can reason about." The IR
strategy's recipe produces a **structured, queryable model of every code unit in the
repo** — not just a search index, not just summaries. Think of it less like "search bar
over my code" and more like "build a wiki + diagram of every function and class, with
all their relationships already drawn."

The output is a directory tree of JSON records on disk. Every phase persists its output
before the next phase starts, so the strategy is **fully resumable** — kill the process
mid-run, re-run, and only the missing work is repeated.

---

## Why "intermediate representation"?

The output isn't the raw source code, and it isn't the finished knowledge graph either —
it sits **in between**. Raw source is too low-level to ask questions about ("what calls
`start()`?" is hard to answer with grep). The final graph is too far removed from the
source to debug. The IR is the bridge: every file becomes a JSON document, every
function / class / variable inside it becomes its own JSON document, and those documents
already contain the structured edges (`X calls Y`, `Y is a member of Z`, `Z extends W`)
the graph layer will later import.

---

## Storage roots — where everything lives on disk

Two roots, both under the ByteBell home directory (`~/.bytebell/` by default, resolved
via `getBytebellHome()` in `@bb/config`):

```
~/.bytebell/repos/
  <knowledgeId>/                          ← cloned source tree (one per repo)
  .meta/
    <knowledgeId>/                        ← THE META ROOT for one repo
```

`knowledgeId` is **per repo, not per commit**. Many commits share one `knowledgeId`;
cross-commit incremental indexing reuses the same `metaRoot` across runs and only
invalidates the records belonging to changed files.

All paths below are resolved by the builders in
[`#src/pipeline/paths.ts`](../../pipeline/paths.ts) — `storage.ts` in this folder
never composes a path itself; it only joins what the path builder gives it. The mapping
is enforced by the doc-comment in [storage.ts](storage.ts).

### Full meta-root layout

```
.meta/<knowledgeId>/                              ← metaRoot
  scan-manifest.json                              ← phase 1 output
  bigFiles.json                                   ← (reserved; see MetaPaths)
  repo-summary.json                               ← (reserved for downstream summaries)

  file-analysis/                                  ← phase 2 + small-file unit data
    <encoded relativePath>/
      analysis.json                               ← IrFileAnalysisRecord (one per small file)
      codeUnits/
        <safeUnit>.source.json                    ← phase 6 — raw text of one unit
        <safeUnit>.analysis.json                  ← phase 7 — deep IR for one unit

  big-file-analysis/                              ← phases 3/4/5 + big-file unit data
    <encoded relativePath>/
      boundaries.json                             ← phase 3 — IrBigFileBoundaries
      cut-complete.json                           ← phase 4 — IrCutCompleteRecord (marker)
      chunks/
        chunk-1/
          raw.json                                ← phase 4 — IrBigFileChunkRaw (1-based N)
          analysis.json                           ← phase 5 — IrFileAnalysisRecord
          codeUnits/
            <safeUnit>.source.json                ← phase 6
            <safeUnit>.analysis.json              ← phase 7
        chunk-2/
          …

  folder-specs/                                   ← phase 8
    <encoded folderPath>/
      spec.json                                   ← FolderSpec (one per source folder)
    __ROOT__/                                     ← used when folderPath === ""
      spec.json

  folder-summaries/                               ← (reserved — not written by IR today)
  mcp-enrichment/                                 ← used by the sibling phase2-mcp strategy

  commits/<commitHash>/                           ← commit-scoped artefacts (business context)
    business-context/<sanitizedTitle>/
      original.txt
      analysis.json

  org/<orgId>/                                    ← org-level keyword registry (defaults orgId="local")
```

### Path encoding

Source paths can contain slashes, but every record dir is a single flat segment. Two
encoders in [`paths.ts`](../../pipeline/paths.ts) handle the translation:

| Encoder                | Mapping            | Why                                            |
| ---------------------- | ------------------ | ---------------------------------------------- |
| `encodeMetaPath`       | `/` → `__SL__`     | Slash survives as a single path segment.       |
|                        | `\` → `__BS__`     | Windows-style separators round-trip.           |
| `safeUnitName`         | `[^A-Za-z0-9._-]` → `_`, capped at 80 chars | Filesystem-safe + case-insensitive-FS-safe. |

So `Stopwatch.start` becomes `Stopwatch.start.source.json`, but `My::Class<T>::do_it`
becomes `My__Class_T___do_it.source.json` (truncated to 80 chars).

### Path builders → consumer table

| Builder                             | Builds                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `reposRoot()`                       | `~/.bytebell/repos`                                                          |
| `repoCloneDir(kid)`                 | `<repos>/<kid>` — where the repo gets cloned                                 |
| `metaRootFor(kid)`                  | `<repos>/.meta/<kid>` — root of all IR artefacts                             |
| `metaPathsFor(kid)`                 | The `MetaPaths` struct (all top-level dirs precomputed)                      |
| `commitMetaDir(kid, hash)`          | `<metaRoot>/commits/<hash>` — per-commit content                             |
| `businessContextDir(kid, hash, t)`  | `<commitMeta>/business-context/<t>` — one business-context analysis          |
| `orgRegistryDir(kid, orgId)`        | `<metaRoot>/org/<orgId>` — keyword registry                                  |
| `fileDirFor(mp, rel)`               | `<fileAnalysisDir>/<encoded>` — owns one small file                          |
| `fileAnalysisRecordPath(mp, rel)`   | `<fileDir>/analysis.json`                                                    |
| `bigFileDirFor(mp, rel)`            | `<bigFileAnalysisDir>/<encoded>` — owns one big file                         |
| `bigFileBoundariesPath(mp, rel)`    | `<bigFileDir>/boundaries.json`                                               |
| `cutCompletePath(mp, rel)`          | `<bigFileDir>/cut-complete.json` — phase-4 completion marker                 |
| `bigFileChunkDir(mp, rel)`          | `<bigFileDir>/chunks`                                                        |
| `chunkDirFor(mp, rel, n)`           | `<bigFileChunkDir>/chunk-N` (1-based)                                        |
| `bigFileRawChunkPath(mp, rel, n)`   | `<chunkDir>/raw.json`                                                        |
| `bigFileAnalysedChunkPath(mp, rel, n)` | `<chunkDir>/analysis.json`                                                |
| `unitDirFor(mp, rel, n\|null)`      | small: `<fileDir>/codeUnits`; chunk: `<chunkDir>/codeUnits`                  |
| `unitSourceRecordPath(...)`         | `<unitDir>/<safeUnit>.source.json`                                           |
| `unitAnalysisRecordPath(...)`       | `<unitDir>/<safeUnit>.analysis.json`                                         |
| `folderSpecDir(mp, folder)`         | `<metaRoot>/folder-specs/<encoded or __ROOT__>`                              |
| `folderSpecRecordPath(mp, folder)`  | `<folderSpecDir>/spec.json`                                                  |

All record directories are created with `mode 0o700` (owner-only).

---

## Cache semantics — what "skip if present" means at every phase

Every persisted file IS the cache. The strategy never holds a separate cache index;
"is it cached?" is always answered by `access()` on the corresponding record path. The
check is intentionally **presence-only** (no hash compare, no mtime compare) because:

1. `metaRoot` is keyed by `knowledgeId`, not by commit.
2. Cross-commit invalidation (`incremental.ts`) deletes records for changed files
   *before* the phases run — so by the time a phase asks "is this path cached?", any
   stale record has already been removed.

Per-phase cache rules:

| Phase | Cache file                                                | Behaviour on hit              |
| ----- | --------------------------------------------------------- | ----------------------------- |
| 1     | `scan-manifest.json`                                      | Re-walk anyway (cheap)        |
| 2     | `file-analysis/<enc>/analysis.json`                       | Skip LLM call                 |
| 3     | `big-file-analysis/<enc>/boundaries.json`                 | Skip skim                     |
| 4     | `big-file-analysis/<enc>/cut-complete.json` **AND** every `chunks/chunk-N/raw.json` referenced by `totalChunks` | Skip cut. Marker alone is not enough — a partial cut from an interrupted run is detected by counting `raw.json` files. |
| 5     | `chunks/chunk-N/analysis.json`                            | Skip LLM call                 |
| 6     | `codeUnits/<safeUnit>.source.json`                        | Skip extraction               |
| 7     | `codeUnits/<safeUnit>.analysis.json`                      | Skip LLM call                 |
| 8     | `folder-specs/<enc>/spec.json`                            | Phase is pure; idempotent overwrite |

Phase 7 is by far the most expensive. Caching is what makes incremental re-indexing
affordable.

---

## How it works — eight phases, one after another

Each phase has a single responsibility, writes its output to disk before the next
starts, and can be re-entered safely. The full sequence is wired in
[`index.ts`](index.ts).

### Phase 1 — Scan & classify

Walk every file the source reader yields and bucket it:

- **small** — fits in one LLM context window, analysed in one shot.
- **big** — too big for one window, will be cut into chunks.
- **oversized** — beyond the configured limit (default 120,000 tokens), skipped.

Binary files (images, executables) are filtered out before they reach this phase.

**Writes:** `metaRoot/scan-manifest.json` — a flat list of every file with its kind,
size, and token count.

### Phase 2 — Analyse small files

For each `small` entry, run one LLM call (`analyseFile`) that returns a
`FileAnalysisResult`:

- A module-level summary (purpose, summary, business context, keywords, imports, etc.).
- A list of every code unit found in the file, with line spans + verbatim source
  slices.

**Writes:** `file-analysis/<encoded>/analysis.json` (`IrFileAnalysisRecord`).
**Skips when:** `analysis.json` already exists for that file.

### Phase 3 — Compute boundaries (big files)

To safely cut a big file into chunks we have to know where the safe cut points are.
Every chunk boundary must land on a declaration start, never inside a function. This
phase does a **skim** pass — multiple smaller LLM calls, each over a sliding window of
the file, that together produce a list of every top-level declaration and its first-line
signature. A non-LLM step then **locates** each declaration in the source by verbatim
signature match.

**Writes:** `big-file-analysis/<encoded>/boundaries.json` (`IrBigFileBoundaries`).
**Skips when:** `boundaries.json` already exists.

### Phase 4 — Cut big files (no LLM)

Read the boundaries from phase 3, walk the source, emit chunks. A chunk is a contiguous
range of declarations whose total tokens stay under a configured limit
(default 4,000–10,000). Whole declarations only — never split.

**Writes:**
- `big-file-analysis/<encoded>/chunks/chunk-N/raw.json` (`IrBigFileChunkRaw`, 1-based).
- `big-file-analysis/<encoded>/cut-complete.json` (`IrCutCompleteRecord` — marker).

**Skips when:** `cut-complete.json` exists AND its `totalChunks` matches the number of
`chunk-N/raw.json` files on disk. The marker alone is insufficient: an interrupted run
must re-cut.

### Phase 5 — Analyse big chunks

For each raw chunk, run the **same** LLM call phase 2 ran on small files —
`analyseFile` — but applied to one chunk. All chunks of one big file share the parent
file's `relativePath`; the chunk number lives in the filename only. Chunks are **not**
rolled up into a per-file manifest.

**Writes:** `big-file-analysis/<encoded>/chunks/chunk-N/analysis.json`
(`IrFileAnalysisRecord`).
**Skips when:** `chunk-N/analysis.json` already exists.

### Phase 6 — Extract unit sources (no LLM)

Read every `analysis.json` written by phases 2 and 5. Each record's `units[]` already
contains a verbatim source slice. For every unit, write a `<safeUnit>.source.json`
record into the file's (or chunk's) `codeUnits/` directory. Each source record carries
its sha256, size, and token count — the inputs phase 7 needs.

**Writes:**
- Small file: `file-analysis/<encoded>/codeUnits/<safeUnit>.source.json`.
- Big chunk: `big-file-analysis/<encoded>/chunks/chunk-N/codeUnits/<safeUnit>.source.json`.

**Skips when:** the target `<safeUnit>.source.json` already exists.

### Phase 7 — Analyse each code unit

The most expensive phase. For every `<safeUnit>.source.json` written by phase 6, run
one LLM call (`analyzeUnitIr` → `extractUnit`) that produces a deep structured IR for
that unit:

- All `parameters` with names + types + defaults + variadic/optional flags.
- The `returnType`.
- Every `call` this unit makes (function name, which file/scope it resolves to,
  internal vs external).
- Every `symbolReference` (other symbols used, not just called).
- For containers (classes, structs, traits, etc.): every `member`, every `memberUnitId`,
  every `baseType`, every `implementsType`.
- A `logicOutline` — a structured trace of the unit's control flow as branch / loop /
  call / return / raise steps.
- Pre/post-conditions, invariants, edge cases, error policy, state mutations, events
  emitted, complexity, decorators, modifiers, visibility, async/static/abstract flags,
  generic type parameters, verbatim blocks, example I/O pairs, test references.
- A deterministic `semanticFingerprint` computed in code (never by the LLM).

The schema lives in
[`unit-analysis/types/code-unit.ts`](unit-analysis/types/code-unit.ts).

**Writes:** `<unitDir>/<safeUnit>.analysis.json` (`IrUnitAnalysisRecord`).
**Skips when:** the target `<safeUnit>.analysis.json` already exists.

### Phase 8 — Derive folder specs (no LLM)

Aggregate every small file's file-level IR in a folder into a per-folder `FolderSpec`
capturing the folder's shared representation family / type, concurrency model,
reconstruction hints, language. File records are never mutated; the FolderSpec is a
parallel artefact.

**Writes:** `folder-specs/<encoded folderPath>/spec.json` (or `__ROOT__/spec.json` for
the repo root).

---

## Cross-commit incremental indexing

The IR strategy itself is single-commit. A driver that walks a sequence of commits for
the same `knowledgeId` reuses the same `metaRoot` across runs and lets the helpers in
[`incremental.ts`](incremental.ts) handle invalidation.

The flow per commit:

1. `findPriorIndexedCommit(candidates)` — walks the caller-supplied candidate list
   backward (most recent first) and returns the first commit whose `metaRoot` is on
   disk. This is what makes resumption work across driver restarts: even if the
   in-memory `prevCommit` is gone, the on-disk `metaRoot` is still there.
2. `applyDiffInvalidation({ prevMetaRoot, currMetaRoot, diff })`:
   - `cp -R` `file-analysis/` and `big-file-analysis/` from `prevMetaRoot` to
     `currMetaRoot`.
   - For every `relativePath` in `diff.modified`, `diff.deleted`, and both sides of
     every `diff.renamed` pair, `rm -rf` its records:
     - `file-analysis/<enc(rel)>/` (parent + `codeUnits/`)
     - `file-analysis/<enc(rel)>__*` siblings (legacy per-unit children)
     - `big-file-analysis/<enc(rel)>/` (boundaries + cut-complete + chunks)
     - `big-file-analysis/<enc(rel)>:chunk-*` siblings (legacy per-chunk children)
3. Phases 2–7 then run unchanged. Cached records for unchanged files are still there,
   so they short-circuit; invalidated paths re-run; added paths run fresh.
4. `deleteAllForFile(metaPaths, relativePath)` is the same operation exposed as a
   one-shot for callers that want to wipe one file's artefacts directly (e.g. before
   re-ingesting).

`added` paths have no cached record, so they need no invalidation step — they just
appear in the scan manifest as new work.

Structured INFO lines (`ir/incremental: <prev> → <curr> added=… modified=… …` and
`ir/incremental: <curr> — no prior indexed commit found, running full first-time
index`) make the mode visible in logs.

---

## A worked example

Imagine you've ingested a Dart file `lib/stopwatch.dart` with a single `Stopwatch`
class. The encoded path is `lib__SL__stopwatch.dart`.

After **phase 1**:

```
<metaRoot>/scan-manifest.json    ← { entries: [{ relativePath: "lib/stopwatch.dart",
                                                 kind: "small", tokenCount: 412, ... }] }
```

After **phase 2** (small file, one LLM call):

```
<metaRoot>/file-analysis/lib__SL__stopwatch.dart/
  analysis.json                  ← { relativePath: "lib/stopwatch.dart",
                                     analysis: {
                                       module: { summary: "Measures elapsed time…", …},
                                       units: [
                                         { qualifiedName: "Stopwatch",       startLine: 48, endLine: 139, … },
                                         { qualifiedName: "Stopwatch.start", startLine: 82, endLine: 90,  … },
                                         …
                                       ]
                                     }, … }
```

After **phase 6**:

```
<metaRoot>/file-analysis/lib__SL__stopwatch.dart/codeUnits/
  Stopwatch.source.json
  Stopwatch.start.source.json
  Stopwatch.elapsed.source.json
  …  (one per unit)
```

After **phase 7**, beside each `*.source.json`:

```
  Stopwatch.start.analysis.json  ← { codeUnit: {
                                       qualifiedName: "Stopwatch.start",
                                       unitKind: "method",
                                       returnType: "void",
                                       calls: [{ name: "_now", source: "Stopwatch", kind: "internal" }],
                                       symbolReferences: ["Stopwatch._stop", "Stopwatch._start"],
                                       logicOutline: [
                                         { step: "branch", condition: "_stop != null", children: [...] },
                                         { step: "call",   desc: "set _start = _now()" },
                                         …
                                       ],
                                       semanticFingerprint: "sha256:…"
                                     } }
```

From that one record the downstream graph layer draws:

- `Stopwatch.start --(call)--> Stopwatch._now`
- `Stopwatch.start --(uses)--> Stopwatch._stop`
- `Stopwatch.start --(uses)--> Stopwatch._start`
- `Stopwatch --(contains)--> Stopwatch.start` (from `Stopwatch`'s `memberUnitIds`)

---

## What the output is good for

The `<unit>.analysis.json` records are essentially the **rows of a knowledge graph**.
Each declares its edges explicitly:

- `calls[].name + calls[].source` → "this unit calls that one"
- `symbolReferences` → "this unit uses that symbol"
- `memberUnitIds` → "this container contains those units"
- `baseTypes` / `implementsTypes` → "this type inherits / implements those"
- `parameters[].type` + `returnType` → "this unit is typed by these types"

A graph-building layer downstream walks these edges to construct the searchable
knowledge graph; downstream agents (MCP tools, code-aware retrievals, dependency
visualisers) query the graph without ever re-reading the source.

---

## Caching, resumability, and split models

Every phase checks for its output on disk before doing any work. If a unit's
`analysis.json` already exists, phase 7 skips it. If a chunk's `analysis.json` already
exists, phase 5 skips it. Cancel a run mid-flight and re-run — nothing is repeated. A
"half-done" file resumes from exactly the right phase.

The strategy also supports **separate models for different phases**. The
`StrategyContext` has two LLM-config slots:

- `llmCallContext` — used by phases 2/3/5 (file-level analysis).
- `unitsLlmCallContext` — used by phase 7 (per-unit deep analysis).

A common pattern is to route file-level calls through a high-capability model
(e.g. Claude) and per-unit calls through a fast/cheap model (e.g. MiniMax M3),
trading per-unit nuance for ~10× lower cost. When `unitsLlmCallContext` is unset,
phase 7 falls back to `llmCallContext`. Concurrency is `Config.LlmConcurrency`
across all phases; phase 7 can be lowered via `IrStrategyDeps.unitsConcurrency` when
the units model has a tighter rate limit.

---

## What it *doesn't* do

- No folder summaries, no repo summary, no README synthesis. (Folder *specs* — a
  structural roll-up — yes; prose summaries — no.)
- No Neo4j writes, no Mongo writes, no graph-edge persistence — the IR records are
  pure JSON on disk; the graph layer is a separate downstream concern.
- No reconstruction (regenerating source from IR is a separate strategy in another
  package).
- No skim-decision / skip-file heuristics — every eligible file the scanner returns
  gets analysed unless it's oversized.

---

## Cost & speed (rough rules of thumb)

For a small file: 1 LLM call (phase 2) + 1 call per unit (phase 7). A 100-line file
with 8 units → 9 calls.

For a big file: ~3 LLM calls per skim window (phase 3) + 1 call per chunk (phase 5) +
1 call per unit (phase 7). A 1,500-line file cut into 3 chunks with 60 units total →
9 + 3 + 60 ≈ 72 calls.

A whole medium-sized repo (~14 files, mix of small + big, ~900 units) lands around
1,000 LLM calls. Mostly dominated by phase 7. With caching, re-runs after incremental
edits are dramatically cheaper — only changed files trigger fresh work.

---

## Files

| File                                    | Responsibility                                                            |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `index.ts`                              | Strategy facade. `createIrStrategy()` returns an `IngestStrategy`.        |
| `records.ts`                            | File-level record types (`IrFileAnalysisRecord`, `IrBigFileBoundaries`, `IrBigFileChunkRaw`). |
| `types.ts`                              | Per-unit record types (`IrUnitSourceRecord`, `IrUnitAnalysisRecord`) + skim/outline types. |
| `storage.ts`                            | Disk I/O — save / read / list / delete helpers. ALL paths come from `#src/pipeline/paths.ts`. |
| `incremental.ts`                        | Cross-commit driver helpers — `findPriorIndexedCommit`, `applyDiffInvalidation`, log lines. |
| `chunking.ts`                           | Declaration-boundary chunker (phase 4).                                   |
| `parse.ts`                              | `TokenUsage` arithmetic.                                                  |
| `usage.ts`                              | Re-exports for downstream callers.                                        |
| `phases/scan-and-classify.ts`           | Phase 1.                                                                  |
| `phases/analyse-small.ts`               | Phase 2.                                                                  |
| `phases/compute-boundaries.ts`          | Phase 3.                                                                  |
| `phases/cut-big-files.ts`               | Phase 4 (pure).                                                           |
| `phases/analyse-big-chunks.ts`          | Phase 5.                                                                  |
| `phases/extract-unit-sources.ts`        | Phase 6 (pure).                                                           |
| `phases/analyse-units.ts`               | Phase 7.                                                                  |
| `phases/derive-folder-specs.ts`         | Phase 8 (pure).                                                           |
| `file-analysis/`                        | `analyseFile` — the file/chunk-level LLM call (used by phases 2, 3, 5).   |
| `unit-analysis/`                        | `analyzeUnitIr` + `extractUnit` + fingerprint (phase 7's workhorse).      |
| `big-file/`                             | Skim + declaration-locator helpers (used by phases 3 + 4).                |
| `folder-spec/`                          | `FolderSpec` types + storage (phase 8 output).                            |
| `prompts/`                              | Prompt templates for the file-level and unit-level LLM calls.             |
