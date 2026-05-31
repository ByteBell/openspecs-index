# Plan — File-Analysis v2 and the `Phase2MCP` Enrichment Strategy

Status: proposal, not yet implemented.
Authors: Saurav + Claude. Date: 2026-05-30.
Scope: file-level intermediate representation (IR) emitted by `intermediate-representation/` and the follow-up cross-file enrichment that consumes it.

---

## Why this plan exists

The current per-file analysis (`FileAnalysis` in `@bb/mongo`) captures intent at a paraphrase level — purpose, summary, classes, functions, imports, a free-prose `sectionMap`, a single `dataFlowDirection` string. That is enough for retrieval. It is **not** enough for reconstruction: a reconstructor reading the analysis cannot recover boundary semantics (`<` vs `<=`), cannot recover verbatim literals (regex / SQL / prompt strings / error messages), cannot distinguish a sequence from a branch from a loop in a section, and cannot tell which fields in the file came from an imported alias versus a locally-declared shape.

Six research papers (see `docs/research-grounding-v2.md` to be added) frame what a reconstruction-grade IR needs to carry. The dominant findings:

- **Round-Trip Correctness (Allamanis):** measure quality as `sim(x, M⁻¹(M(x)))`. The IR must encode information that produces lift over reconstruction-from-signature alone.
- **RTCE compression / decompression:** state tracking, variable dependencies, and control flow are where reconstruction systematically breaks. Type shapes, dataflow edges, and structured control flow are non-negotiable.
- **Summary-Mediated Repair (Twist):** error-aware summaries dominate intent-only summaries. Edge cases, boundary conditions, and error handling must be first-class fields, not asides.
- **Self-Spec:** model-authored structured specs hit the sweet spot between rigid formal schemas and free-form prose. Let the model pick a representation family per file.
- **SCoT prompting:** organize intermediate reasoning around `sequence | branch | loop`. The section map must be structure-shaped, not narrative.
- **Semantic compression (Grassucci):** properly aligned multimodal fields compress to a centroid without quality loss. Add a fused canonical paragraph the reconstructor reads by default.

v2 is the schema that lands those findings. `Phase2MCP` is the enrichment stage that turns v2's TBDs into facts using the graph database.

---

## Two-stage analysis: pass-1 (in-file) vs pass-2 (cross-file)

A file's IR is produced in two passes.

**Pass-1 — in-file.** The LLM sees only the file's content (or one chunk of a big file). It captures everything that can be derived from the file alone: representation type, public signatures, type shapes, structured section map, local call graph, data-flow edges within the file, verbatim literals, edge cases, boundary conditions, error handling, invariants, diagnostic notes, assumptions, fingerprint, hints. Anything cross-file (the real shape behind an imported type, who consumes a contract this file provides, the file that backs an import specifier) is recorded as an explicit `ambiguity` — never guessed.

**Pass-2 — cross-file, MCP-mediated.** A second LLM call reads pass-1, reads every sibling chunk of the same file (for big files), and reaches across the knowledge graph via four MCP tools to resolve cross-file claims. It may refine any field but must tag every change with `pass2` provenance. It clears the ambiguities it can answer, sharpens the ones it cannot, and never invents a neighbor that does not exist.

Pass-1 is owned by the IR strategy (`intermediate-representation/`). Pass-2 is owned by a new sibling strategy, `phase2-mcp/`.

---

## v2 schema — what changes from v1 `FileAnalysis`

v2 preserves every concept v1 captured; some are reshaped to carry more signal, and several new fields are added. The high-level groupings:

**Reconstruction substrate** — the fields that produce RTC lift over reconstruction-from-signature.

- `representationFamily` (closed enum) and `representationType` (free label).
- `publicSignatures` — verbatim, with parameter names, defaults, return types, generics, decorators, anchors. Replaces v1's bare `classes: string[]` / `functions: string[]`.
- `typeShapes` — exact shape of every declared interface / type / enum, with discriminant for unions, anchors.
- `localCallGraph` — within-file caller→callee edges with origin and kind.
- `dataFlowGraph` — within-file producer→consumer edges with payload and transformation. Replaces v1's single `dataFlowDirection: string`.
- `verbatimLiterals` — regex, SQL/Cypher, prompt strings, error messages, format strings, magic numbers, env keys, URLs, header names, mime types — copied verbatim from source with anchors.
- `importsInternal` / `importsExternal` — structured objects with `spec`, `symbols`, and pass-2-only `resolvedRelativePath` / `resolvedFileId` / `package`.
- `canonicalCentroid` — single ≤ 200-token paragraph used as the default reconstruction prompt.

**Error-aware fields** (Twist).

- `edgeCases` — explicit list of input shapes (empty, single-element, max-size, overflow, race, retry, partial-failure) with handled/behavior.
- `boundaryConditions` — every `<`, `<=`, `>`, `>=` comparator with inclusivity and NL intent. This is the field that prevents off-by-one drift.
- `errorHandling` — per error path: thrown / caught / action / fallback / anchor.
- `invariants` — pre / postconditions, non-null promises, ordering constraints.
- `diagnosticNotes` — flagged tricky / surprising / bug-magnet passages.

**Orchestration fields** (SCoT + Self-Spec).

- `sectionMap` entries are now structured: `{ name, intent, structureKind ∈ {sequence|branch|loop|try|async|generator|recursion|io|declaration}, predicate?, branchOutcomes?, bounds?, terminationCondition?, anchor }`. Replaces v1's free-prose `description`.
- `assumptions` — about callers, env, config, init order.
- `ambiguities` — TBDs the analyzer was unsure about; pass-2 clears these.
- `concurrencyModel` — sync / async / streaming / event / generator / mixed, plus reentrancy and ordering guarantees.
- `stateModel` — present only when `representationFamily === "state-machine"`.

**Shape + compression** (Grassucci).

- `fileFingerprint` — line count, declaration count, max nesting depth, rough cyclomatic.
- `reconstructionHints` — naming style, return style, comment style, dialect.

**v1 carryovers, reshaped or unchanged.**

- Unchanged: `purpose`, `summary`, `businessContext`, `keywords`, `ontologyConcepts`, `businessEntities`, `systemCapabilities`, `configDependencies`.
- Reshaped: `sideEffects` becomes a categorized object (`io | network | env | fs | process | mutationOfArg`), each holding a string list. `integrationSurface` values now use the prefix syntax the graph's `integration` channel indexes on (`api_call:`, `event_pub:`, `event_sub:`, `table_read:`, `table_write:`, `grpc:`, `queue:`, `shared_schema:`, `ws:`). `contractsProvided` / `contractsConsumed` are structured objects with `name`, `shape`, and pass-2-only resolution fields.

**Scope discipline for big files.** Every chunk record carries the full v2 shape, scoped to its line range. Chunks of the same file each emit their own representation type, fingerprint, etc.; pass-2 receives all sibling chunks as context and consolidates same-file facts before reaching across files.

---

## Pass-1 — where it slots into the IR strategy

The IR strategy keeps its current five-phase shape (scan → analyse-small → compute-boundaries → cut-big-files → analyse-big-chunks). v2 pass-1 is layered onto the analysis phases without restructuring them.

For each file or chunk the analysis phase processes, after the existing analyser writes its `IrFileAnalysisRecord`, a second LLM call runs the v2 pass-1 prompt against the same content (read from disk via the existing `source.readFile` pattern). The v2 result is stored on the same record under an `analysisV2` field, alongside the existing `analysis` payload. Both shapes coexist on disk; existing readers see the legacy `analysis` field untouched.

The v2 pass-1 phase is **diff-aware by inheritance**: it reuses the existing `applyDiffInvalidation` machinery. On an incremental commit, that step has already deleted the records for added / modified / renamed (both sides) / deleted files. Pass-1 only touches records that are missing or lack `analysisV2`. Files unchanged since the last index keep their cached v2 record untouched.

Failure semantics match the existing analyser: an unparseable v2 response degrades to an empty `FileAnalysisV2` with the ambiguity field populated, rather than failing the job. LLM transport / config errors bubble up.

---

## Pass-2 — `phase2-mcp/`, a sibling strategy

`Phase2MCP` is a **standalone strategy** living next to `intermediate-representation/` and `flat-folder/`. It implements the same `IngestStrategy` port. It is dispatched independently — typically by a follow-up worker after the IR strategy completes and the v2 records have been indexed into the graph.

The strategy executes one phase: per-record cross-file enrichment.

**Inputs.** A `knowledgeId`, the meta-paths root of the IR strategy run for the same commit, and the diff set produced by `applyDiffInvalidation` (the list of `relativePath`s whose records were rewritten in this run). For first-time indexing, the diff set is the whole tree.

**Per record.** For each pass-1 v2 record on disk in the diff set, Phase2MCP invokes one LLM call with the pass-2 prompt. The prompt receives the record's pass-1 v2 JSON, every sibling chunk's pass-1 v2 JSON (for big files), and the original file or chunk content (for verification, not re-analysis).

**MCP tools.** The LLM has access to four read-only tools, exposed through an in-process `McpToolset` interface so the strategy is not coupled to a running HTTP MCP server:

- `retrieve_file({ path, meta: true })` — return v2 records for a path within the current knowledge.
- `smart_search({ query, knowledgeId?, path?, exclude? })` — broad ranked top-30.
- `graph_search({ channels, query, knowledgeId?, path?, glob? })` — channelled lookup.
- `keyword_lookup({ keyword, types?, knowledgeId? })` — OrgKeyword-anchored, optionally cross-repo.

The toolset implementation is wired by the orchestrator. The default binding routes through the graph database the IR strategy populated; alternative bindings (in-process disk reader for ingestion-time use; HTTP MCP client for follow-up runs) are pluggable.

**Budget.** Every LLM invocation has a hard cap of **20 MCP tool calls**. The cap is enforced by the toolset wrapper and logged into `_provenance.toolCalls`. A call that hits the cap stops fetching and emits the best output it has, marking unresolved fields in `_provenance.pass2Notes`.

**Refinement rules.** Pass-2 may refine any field but must preserve verbatim literals and boundary conditions (append-only from pass-2's perspective). It records, for every populated field, whether the value originated in pass-1 or pass-2; for pass-2 changes it records a one-line reason; for every neighbor fetched it records the relative path and the tool call.

**Output.** A refined v2 record plus a `_provenance` block. Written back to the same record on disk and re-indexed into the graph.

---

## Diff-only execution

Both v2 pass-1 and `Phase2MCP` honour the diff produced by `diffCommits()` and `applyDiffInvalidation()`:

- **Added files** — new records, full pass-1 + pass-2.
- **Modified files** — old records deleted, full pass-1 + pass-2.
- **Renamed files** — old-path and new-path records both deleted; new-path records re-analysed under pass-1 + pass-2. The rename is reflected in import resolution by the next pass-2 run of any file that imported the old path.
- **Deleted files** — old records deleted. Nothing to re-analyse.
- **Unchanged files** — cached records remain; no LLM call for either pass.

For a first index, every file is in the diff. For an incremental commit, only the diff list is touched, which preserves the LLM-cost profile of the existing strategy.

---

## Disk-read pattern

The v2 pass-1 analyser reads file content via the existing `source.readFile(relativePath)` channel, the same way the current `analyse-small` phase does. For big-file chunks, content is read from the cached `chunk-N.raw.json` record produced by the cut phase, again matching the existing pattern. No new I/O path is introduced.

The v2 pass-2 analyser does **not** re-read source from disk for the main analysis — it works from the pass-1 v2 record. The original content is provided to it only as a verification surface (when the LLM wants to double-check a pass-1 claim against the literal source). For big files, the chunk's own content is what's read; sibling chunks are read as pass-1 v2 records only.

---

## Storage layout

Pass-1 v2 records share storage with the existing IR records. The `IrFileAnalysisRecord` gains two optional fields: `analysisV2` (the v2 payload) and `analysisProvenance` (the audit trail, populated only after pass-2 runs). The legacy `analysis` field is untouched.

On-disk paths are unchanged: `fileAnalysisDir/<encoded>.json` for small files, `bigFileChunksDir/<encoded>/chunk-N.json` for chunks.

Graph indexing of v2 records (the step that makes pass-2's MCP lookups answer correctly) happens between the IR strategy and the `Phase2MCP` strategy in the orchestrator. That indexing step is **not** in scope for this plan; it is owned by the graph-writing tier downstream.

---

## Failure modes and retries

A pass-1 v2 call that returns unparseable JSON degrades to an empty v2 payload with `ambiguities` populated. Pass-2 will subsequently see an empty payload and either fully reconstruct it from neighbors or leave it empty with sharper ambiguities — never blocking the job.

A pass-2 call that exhausts its 20-tool-call budget completes with whatever facts it could gather and records the exhaustion in `_provenance.pass2Notes`. Subsequent runs (e.g. after more files are indexed) may re-run pass-2 on records where the budget was exhausted; the toolset records this so it can be detected.

LLM transport / configuration errors bubble up from both passes and fail the job, matching the existing analyser's behaviour.

---

## Out of scope for this plan

- The graph-writing step that indexes v2 records into Neo4j between pass-1 and pass-2.
- The reconstruction pipeline (`reconstruction/`) — its `ModuleIr` + `CodeUnit` IR is a deeper, unit-level representation owned by a different layer. v2 is the file-level reconstruction-grade IR; the two are complementary, not redundant.
- Migration of pre-v2 records. Historical records remain v1 until their files re-enter the diff.
- Anything outside the IR + Phase2MCP path: flat-folder, reconstruction, retrieval, MCP server changes (the MCP server already exposes the four tools; only the in-process binding is new).

---

## Acceptance criteria

A successful landing of this plan requires:

1. The v2 schema exists in `@bb/types`, split across files that each respect the 300-line rule.
2. The IR strategy's analysis phases write `analysisV2` to every record they produce, only when the record is missing or has no v2 payload.
3. The `phase2-mcp/` strategy implements `IngestStrategy`, accepts an injected `McpToolset`, runs the pass-2 prompt per record in the diff set, enforces the 20-call cap, and writes `_provenance`.
4. Every modified folder has its `context.md` / `README.md` updated in the same change set.
5. Typecheck passes; verification commands listed in the root CLAUDE.md for `#src/*`, `.ts` extensions, and the absence of `.d.ts` files return zero matches.

Implementation proceeds only after this plan is approved.
