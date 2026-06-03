# Intermediate Representation — what it does (in plain English)

This folder is one of ByteBell's ingestion **strategies**. A strategy is "the recipe for
turning a freshly-cloned repo into something a machine can reason about." The IR strategy's
recipe produces a **structured, queryable model of every code unit in the repo** — not just
a search index, not just summaries. Think of it less like "search bar over my code" and
more like "build a wiki + diagram of every function and class, with all their relationships
already drawn."

## Why "intermediate representation"?

The output isn't the raw source code, and it isn't the finished knowledge graph either —
it sits **in between**. Raw source is too low-level to ask questions about ("what calls
`start()`?" is hard to answer with grep). The final graph is too far removed from the
source to debug. The IR is the bridge: every file becomes a JSON document, every function /
class / variable inside it becomes its own JSON document, and those documents already
contain the structured edges (`X calls Y`, `Y is a member of Z`, `Z extends W`) the graph
layer will later import.

## The big picture

You give the strategy a folder containing source files. You get back a directory tree of
JSON records — one per file, one per code unit. Specifically:

```
<repo's meta directory>/
  scan-manifest.json                  every file the scan saw, tagged small/big/oversized
  file-analysis/<filename>/
    analysis.json                     module-level summary of the file
    codeUnits/
      <unit>.source.json              the raw text of one function/class/etc.
      <unit>.analysis.json            the LLM-derived structured IR for that unit
  big-file-analysis/<filename>/
    boundaries.json                   where in the file to safely cut chunks
    chunks/chunk-N/
      raw.json                        chunk N's source content
      analysis.json                   module-level summary of chunk N
      codeUnits/<unit>.{source,analysis}.json
```

If a file is small enough to fit one LLM call, everything about it lives under
`file-analysis/`. If a file is too big for one call, it's first cut into chunks, each
chunk is analysed like a small file, and everything for it lives under `big-file-analysis/`.

## How it works — seven phases, one after another

The strategy runs as a fixed sequence of phases. Each phase writes its output to disk
*before* the next one starts. That means if the process crashes — or you cancel and
re-run — the next run picks up exactly where it left off. No phase wastes an LLM call
on work that's already been done.

### Phase 1 — Scan & classify

Walk every file in the repo and decide what kind of file it is. There are three buckets:

- **small** — fits in one LLM context window, will be analysed in one shot.
- **big** — too big for one window but still tractable, will be cut into chunks.
- **oversized** — beyond the configured limit (default 120,000 tokens), skipped entirely.

Binary files (images, executables) are filtered out before they reach this phase. The
output of phase 1 is `scan-manifest.json`, a flat list of every file along with its kind
and token count.

### Phase 2 — Analyse small files

For each **small** file, run one LLM call that returns:

- A module-level summary (purpose, summary, business context, keywords, imports, etc.).
- A list of every code unit found inside the file, with line spans (`Stopwatch.start`
  lives at lines 82–90, for example).

The result is written to `file-analysis/<filename>/analysis.json`. If that file already
exists from a prior run, the file is skipped — the cache hit avoids re-paying for the
same LLM call.

### Phase 3 — Compute boundaries (for big files)

A "big" file is one we can't read in one go. To safely cut it into smaller chunks we have
to know where the safe cut points are: every chunk boundary should land on a declaration
start, never in the middle of a function. Phase 3 does a **skim** pass — multiple smaller
LLM calls, each looking at a sliding window of the file, that together produce a list of
every top-level declaration along with its first-line signature.

Then a non-LLM step **locates** each declaration in the source by verbatim signature
match. The result is written to `big-file-analysis/<filename>/boundaries.json`.

### Phase 4 — Cut big files

No LLM. Read the boundaries from phase 3, walk the source, and emit chunks. A chunk is a
contiguous range of declarations whose total tokens stay under a configured limit
(default 4,000–10,000). Whole declarations only — a chunk never starts or ends in the
middle of a function. Each chunk's raw content is written as
`big-file-analysis/<filename>/chunks/chunk-N/raw.json`.

### Phase 5 — Analyse big chunks

For each chunk produced by phase 4, run the same kind of LLM call that phase 2 ran on
small files — module-level summary plus a list of code units in *that chunk*. The result
is written as `big-file-analysis/<filename>/chunks/chunk-N/analysis.json`. All chunks of
one big file share the parent file's `relativePath` — the chunk number lives only in the
filename.

### Phase 6 — Extract unit sources

No LLM. Read every `analysis.json` written by phases 2 and 5. Each one already contains
a `units` list, and every unit's `startLine`/`endLine` lets us slice its source out of
the file content. For every unit, write a `<unit>.source.json` record into the file's
`codeUnits/` (or the chunk's `codeUnits/`) directory. This is the input for phase 7.

### Phase 7 — Analyse each code unit

The most expensive phase. For every `<unit>.source.json` written by phase 6, run one LLM
call that produces a *deep* structured IR for that unit:

- All `parameters` with names + types + defaults + variadic/optional flags.
- The `returnType`.
- Every `call` this unit makes (function name, which file/scope it resolves to, internal
  vs external).
- Every `symbolReference` (other symbols used, not just called).
- For containers (classes, structs, traits, etc.): every `member`, every `memberUnitId`,
  every `baseType`, every `implementsType`.
- A `logicOutline` — a structured trace of the unit's control flow as branch/loop/call/
  return/raise steps.
- Pre/post-conditions, invariants, edge cases, error policy, state mutations, events
  emitted, complexity, decorators, modifiers, visibility, async/static/abstract flags,
  generic type parameters, verbatim blocks, example I/O pairs, test references.
- A deterministic `semanticFingerprint` computed in code (never by the LLM).

Each result is written as `<unit>.analysis.json` beside the unit's source record. The
schema is in [`unit-analysis/types/code-unit.ts`](unit-analysis/types/code-unit.ts).

## What the output is good for

The `<unit>.analysis.json` records are essentially the **rows of a knowledge graph**.
Each one declares its edges explicitly:

- `calls[].name + calls[].source` → "this unit calls that one"
- `symbolReferences` → "this unit uses that symbol"
- `memberUnitIds` → "this container contains those units"
- `baseTypes` / `implementsTypes` → "this type inherits / implements those"
- `parameters[].type` + `returnType` → "this unit is typed by these types"

A graph-building layer downstream walks these edges to construct the searchable knowledge
graph; downstream agents (MCP tools, code-aware retrievals, dependency visualisers) query
the graph without ever re-reading the source.

## A worked example

Imagine you've ingested a Dart file `stopwatch.dart` with a single `Stopwatch` class.

After phase 2 (it's small enough for one shot), you'd have:

```
file-analysis/stopwatch.dart/
  analysis.json    ← {module: {summary: "Measures elapsed time...", ...},
                       units: [Stopwatch (lines 48-139), Stopwatch.start (82-90), ...]}
```

After phase 6, you'd have:

```
file-analysis/stopwatch.dart/codeUnits/
  Stopwatch.source.json                   ← raw class source
  Stopwatch.start.source.json             ← raw method source
  Stopwatch.elapsed.source.json
  ... (one per unit)
```

After phase 7, beside each `*.source.json`:

```
  Stopwatch.start.analysis.json           ← {codeUnit: {
                                              qualifiedName: "Stopwatch.start",
                                              unitKind: "method",
                                              returnType: "void",
                                              calls: [{name: "_now", source: "Stopwatch",
                                                       kind: "internal"}],
                                              symbolReferences: ["Stopwatch._stop",
                                                                 "Stopwatch._start"],
                                              logicOutline: [
                                                {step: "branch",
                                                 condition: "_stop != null",
                                                 children: [...]},
                                                {step: "call", desc: "set _start = _now()"},
                                                ...
                                              ], ... }}
```

From that one record, a graph layer can draw an edge `Stopwatch.start → Stopwatch._now`
(call), edges `Stopwatch.start uses Stopwatch._stop` and `…uses Stopwatch._start`
(symbol-reference), and an edge `Stopwatch contains Stopwatch.start` (membership, from
the `Stopwatch` class's `memberUnitIds`).

## Caching, resumability, and split models

Every phase checks for its output on disk before doing any work. If a unit's
`analysis.json` already exists, phase 7 skips it. If a chunk's `analysis.json` already
exists, phase 5 skips it. So you can safely cancel a run mid-flight and re-run; nothing
is repeated. A "half-done" file resumes from exactly the right phase.

The strategy also supports **separate models for different phases**. The
`StrategyContext` has two LLM-config slots: `llmCallContext` (used by phases 2/3/5 — the
file-level analysis calls) and `unitsLlmCallContext` (used by phase 7 — the per-unit
deep analysis). A common pattern is to route file-level calls through a high-capability
model (e.g. Claude) and per-unit calls through a fast/cheap model (e.g. MiniMax M3),
trading per-unit nuance for ~10× lower cost.

## What it *doesn't* do

- No folder summaries, no repo summary, no README synthesis.
- No Neo4j writes, no Mongo writes, no graph-edge persistence — the IR records are pure
  JSON on disk; the graph layer is a separate downstream concern.
- No reconstruction (regenerating source from IR is a separate strategy in another
  package).
- No skim-decision / skip-file heuristics — every eligible file the scanner returns gets
  analysed unless it's oversized.

## Cost & speed (rough rules of thumb)

For a small file: 1 LLM call (phase 2) + 1 call per unit (phase 7). A 100-line file with
8 units → 9 calls.

For a big file: ~3 LLM calls per skim window (phase 3) + 1 call per chunk (phase 5) +
1 call per unit (phase 7). A 1,500-line file cut into 3 chunks with 60 units total →
9 + 3 + 60 ≈ 72 calls.

A whole medium-sized repo (~14 files, mix of small + big, ~900 units) lands around 1,000
LLM calls. Mostly dominated by phase 7 (the per-unit pass). With caching, re-runs after
incremental edits are dramatically cheaper — only changed files trigger fresh work.
