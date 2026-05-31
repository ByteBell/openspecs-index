# Plan — Landing PLAN-v2 (merged pass-1 + sibling `phase2-mcp/` strategy)

Status: proposal, not yet implemented.
Authors: Saurav + Claude. Date: 2026-05-30.
Scope: pass-1 v2 field expansion inside the existing IR analysis phases, plus a new sibling strategy `phase2-mcp/` that runs pass-2 cross-file enrichment against a remote MCP URL and persists its output under `mcp-enrichment/`.

This document is the implementation companion to `PLAN-v2.md`. It records two material deviations from that plan the user has authorised, and the surfaces the change touches. It contains no code and no pseudo-code.

---

## Why this plan exists

`PLAN-v2.md` is the architectural target. Two of its placements are overridden for this landing:

1. **Field placement.** PLAN-v2 stores v2 fields under a sibling `analysisV2` payload alongside the legacy `analysis`. The user has chosen to **merge v2 fields into the existing analysis surface** instead. The legacy shape and the v2 shape become one shape; there is no parallel record.
2. **Pass-2 transport and storage.** PLAN-v2 mentions an in-process `McpToolset` as the default binding. The user has chosen the **HTTP MCP client binding**: the four MCP tools are issued against a remote MCP URL configured on the strategy, not an in-process disk reader. Pass-2 output is stored under a sibling directory `mcp-enrichment/`, mirroring `fileAnalysisDir/<encoded>.json` for small files and `bigFileChunksDir/<encoded>/chunk-N.json` for chunks. Pass-1 records on disk are not mutated.

Everything else from `PLAN-v2.md` — pass-1 owned by the IR strategy, pass-2 owned by `phase2-mcp/`, round-trip-correctness motivation, diff-only execution, the 20-tool-call cap, failure semantics — stands.

---

## Folder discipline: what `reconstruction/` is, and what it is NOT

This landing enforces a hard scope boundary on the `reconstruction/` folder. It is observed today and tightened here.

**`reconstruction/` exists for one purpose only:** the experimental loop that takes the pass-1 `FileAnalysisResult` and the pass-2 `mcp-enrichment/` record for a given file (or chunk) and attempts to **regenerate the original source code from those two payloads**, then **diffs the regenerated output against the actual file** to score round-trip correctness. Anything that is not part of that recreate-and-diff loop does not live under `reconstruction/`.

Specifically, the following **do NOT belong under `reconstruction/`** and must be relocated out of it as part of this landing:

- **File-analysis types** (`SemanticFields`, `ModuleIr`, `FileAnalysisResult`, `UnitDescriptor`, fingerprint shapes, unit-id helpers). These describe the analysis surface, not the recreate-and-diff loop.
- **File-analysis prompts** (`SPLIT_*`, `FILE_ANALYSIS_FIELDS_BLOCK*`, snake_case JSON shapes, system prompts, prompt builders). These drive pass-1, not reconstruction.
- **File-analysis parsers / narrowers** (anything that narrows raw LLM JSON into `SemanticFields` / `ModuleIr` / `FileAnalysisResult`).
- **File-analysis pipeline / analyzers** (`analyser.ts`, per-language analyzers, splitter scaffolding).

These move into a sibling **`file-analysis/`** folder under `intermediate-representation/`, with subfolders mirroring their concerns (`file-analysis/types/`, `file-analysis/prompts/`, `file-analysis/parse/`, `file-analysis/pipeline/`, `file-analysis/analyzers/`). The phases under `intermediate-representation/phases/` import from `#src/strategies/intermediate-representation/file-analysis/...` instead of `.../reconstruction/...`.

After this landing, the only things under `reconstruction/` are: the regeneration prompt, the regeneration LLM call, the diff/scoring code, and the CLAUDE/context docs that describe that loop. Nothing else.

Verification (must return zero matches after the relocation):

```bash
grep -rEn 'intermediate-representation/reconstruction/(types|prompts|parse|pipeline|analyzers|analyzer|fingerprint|unit-id)' \
  ext/ingestion-engine-public/packages --include='*.ts'
```

---

## Pass-1: where the merged v2 fields live

The IR strategy's analysis surface is the SPLIT-phase output (`FileAnalysisResult`), produced once per small file by `analyseSmallFiles` and once per big-file chunk by `analyseBigChunks`. That surface decomposes into:

- `ModuleIr` — file-level, extends `SemanticFields`.
- `UnitDescriptor[]` — verbatim units the splitter found.

The v2 fields are merged in at the file level only; `UnitDescriptor` is unchanged.

### Onto `SemanticFields` (and therefore `ModuleIr`)

Each chunk of a big file gets the full v2 shape scoped to its line range, per `PLAN-v2.md` §"Scope discipline for big files". The same field block applies to small files and chunks.

- **Reconstruction substrate (file level).** `representationFamily` (closed enum), `representationType` (free label), `publicSignatures` (verbatim with parameter names, defaults, return types, generics, decorators, anchors), `typeShapes` (interfaces/types/enums with discriminants and anchors), `localCallGraph` (caller→callee with origin and kind), `dataFlowGraph` (producer→consumer with payload and transformation), `verbatimLiterals` (regex, SQL/Cypher, prompts, error messages, format strings, magic numbers, env keys, URLs, headers, mime types, with anchors), `canonicalCentroid` (≤ 200-token paragraph used as the default reconstruction prompt).
- **Error-aware fields.** `edgeCases` (input shapes with handled/behavior), `boundaryConditions` (every `<`/`<=`/`>`/`>=` with inclusivity and NL intent), `errorHandling` (per-path thrown/caught/action/fallback/anchor), `invariants` (pre/postconditions, non-null promises, ordering), `diagnosticNotes` (flagged tricky/surprising/bug-magnet passages).
- **Orchestration fields.** `assumptions` (callers, env, config, init order), `ambiguities` (TBDs the analyzer was unsure about — pass-2 clears these), `concurrencyModel` (sync/async/streaming/event/generator/mixed + reentrancy + ordering), `stateModel` (only when `representationFamily === "state-machine"`).
- **Shape + compression.** `fileFingerprint` (line count, declaration count, max nesting depth, rough cyclomatic), `reconstructionHints` (naming style, return style, comment style, dialect).
- **Reshape, not addition.** `sectionMap` entries gain `intent`, `structureKind ∈ {sequence|branch|loop|try|async|generator|recursion|io|declaration}`, `predicate?`, `branchOutcomes?`, `bounds?`, `terminationCondition?`, `anchor`. The legacy free-prose `description` is dropped — this is a breaking change to the on-disk shape since the user chose merge over sibling. `sideEffects` becomes a categorized object (`io | network | env | fs | process | mutationOfArg`). `integrationSurface` values gain the graph's channel prefixes (`api_call:`, `event_pub:`, `event_sub:`, `table_read:`, `table_write:`, `grpc:`, `queue:`, `shared_schema:`, `ws:`). `importsInternal` / `importsExternal` become structured (`spec`, `symbols`, with pass-2-only `resolvedRelativePath` / `resolvedFileId` / `package` reserved but unwritten in pass-1). `contractsProvided` / `contractsConsumed` become structured with `name`, `shape`, and pass-2-only resolution fields reserved.
- **v1 carryovers, unchanged.** `purpose`, `summary`, `businessContext`, `keywords`, `ontologyConcepts`, `businessEntities`, `systemCapabilities`, `configDependencies`, `classes`, `functions`.
- **v1 dropped.** `dataFlowDirection` (the single-string field) is removed; `dataFlowGraph` replaces it.

### Pass-1 code surfaces (no edits in this document — surface map only)

- **Schema types.** `SemanticFields` is the canonical home of every merged file-level field. The IR strategy's `SemanticFields` decouples from `@bb/mongo`'s `FileAnalysis` in this landing — `FileAnalysis` stays at v1 so flat-folder is untouched. `ModuleIr` continues to `extend SemanticFields` and picks up the new fields transitively. These types live under `file-analysis/types/`, not `reconstruction/types/`.
- **Prompt contract.** `SPLIT_JSON_SHAPE` (`file-analysis/prompts/split-fields.ts`) is the snake_case contract the LLM sees. The new keys are added there. The shared `FILE_ANALYSIS_FIELDS_BLOCK` (defined in flat-folder) is **forked** into a v2 block under `file-analysis/prompts/file-analysis-fields-v2.ts`. The new block is referenced only by `SPLIT_SYSTEM_PROMPT`; flat-folder's block is unchanged.
- **Response narrowing.** `file-analysis/parse/analysis-fields.ts`, `file-analysis/parse/module-ir.ts`, `file-analysis/parse/file-split.ts` narrow LLM JSON into `SemanticFields`/`ModuleIr`/`FileAnalysisResult`. Each new field gets a narrower; reshaped fields lose their old narrower and gain a new one. Each narrower file stays ≤ 300 lines; large additions split into per-field files (`file-analysis/parse/v2/boundary-conditions.ts`, etc.).
- **Disk record shape.** `IrFileAnalysisRecord` (`records.ts`) carries `analysis: FileAnalysisResult`; the shape of `analysis` widens transitively. The record's outer fields are unchanged. The on-disk file paths (`fileAnalysisDir/<encoded>.json`, `bigFileChunksDir/<encoded>/chunk-N.json`) are unchanged.
- **Analysis phases.** `analyse-small.ts` and `analyse-big-chunks.ts` call `analyseFile()` and persist via `saveFileAnalysisRecord` / `saveAnalysedChunk`. The user's constraint is hard: **save path, cache-presence check, and worker pool are untouched.** Only the JSON requested from the LLM changes, via `analyseFile()` and the forked prompt. Both phases pick up the new fields automatically because they share the analyser.
- **Strategy facade.** `intermediate-representation/index.ts` is **unchanged** by pass-1. The five existing phases continue to run in the same order. Pass-2 lives in a different strategy.

### Pass-1 failure mode (unchanged from today)

An unparseable LLM response degrades to an empty `FileAnalysisResult` with the v2 `ambiguities` field populated, rather than failing the job. LLM transport / config errors bubble up.

---

## Pass-2: `phase2-mcp/` — a new sibling strategy

`phase2-mcp/` is a standalone strategy living next to `intermediate-representation/` and `flat-folder/`. It implements `IngestStrategy` (same port as the other two). It is dispatched independently by the orchestrator after the IR strategy has completed and any downstream graph-indexing step has populated the MCP-server-backed graph.

### Inputs

- `knowledgeId`.
- The `MetaPaths` root of the IR strategy run for the same commit (so the strategy can read pass-1 records from `fileAnalysisDir/` and `bigFileChunksDir/`).
- A list of `relativePath`s in the diff set (the records rewritten by the current IR run). On a first index this list covers the whole tree.
- An MCP server **URL** (from `@bb/config`; new config key `Phase2McpUrl`). The strategy refuses to start if the URL is missing or unreachable.
- Optional auth headers / token if the MCP URL requires authentication, threaded through `@bb/config`.

### Storage layout

Pass-2 output is written to a new sibling directory under the same `MetaPaths` root:

- Small files → `mcp-enrichment/<encoded>.json`, mirroring `fileAnalysisDir/<encoded>.json` one-to-one.
- Big-file chunks → `mcp-enrichment/<encoded>/chunk-N.json`, mirroring `bigFileChunksDir/<encoded>/chunk-N.json` one-to-one.

The `MetaPaths` type gains a new field `mcpEnrichmentDir`, computed identically to the existing dirs. Pass-1 records on disk are **not** mutated — pass-2 writes are a parallel surface, addressed by the same encoded relative path so a consumer can fetch the two records side by side without a manifest.

Each enrichment record carries:

- The pass-1 record's `relativePath` and (for chunks) `chunkNumber`, for traceability.
- The refined v2 payload — only the fields pass-2 touched, plus their pass-1 origin for reverification.
- `_provenance`: per-field origin (`pass1` vs `pass2`), per-changed-field one-line reason, list of MCP tool calls made (path / query / channel), and `pass2Notes` for any field the run could not resolve.
- `tokenUsage`.
- `mcpUrl` (the URL the run was dispatched against) and `mcpToolCalls` count, for audit.

### MCP toolset (HTTP binding)

`McpToolset` is a thin interface over the four read-only tools described in `PLAN-v2.md` §"MCP tools": `retrieve_file`, `smart_search`, `graph_search`, `keyword_lookup`. The HTTP binding lives under `phase2-mcp/mcp/http-toolset.ts` and:

- Targets the configured MCP URL.
- Wraps every call with a budget counter; **20 tool calls per LLM invocation, hard cap**, enforced in the wrapper. A call that hits the cap stops fetching and the prompt receives a budget-exhausted signal.
- Records every call into `_provenance.mcpToolCalls`.
- Surfaces transport failure as an explicit tool-call error so the LLM can react (e.g. mark `_provenance.pass2Notes`) rather than failing the whole job. The strategy still fails the job on configuration errors (URL missing / 401 / 5xx for the initial reachability probe).

### Per-record loop

For each pass-1 v2 record in the diff set (the strategy runs the same diff-only invariant as the IR strategy), `phase2-mcp/` issues one LLM call with:

- The record's pass-1 v2 JSON.
- Every sibling chunk's pass-1 v2 JSON (big files only).
- The original file or chunk content (verification surface, never re-analysed).
- The `McpToolset` HTTP wrapper, capped at 20 tool calls.

Pass-2 may refine any v2 field but **preserves verbatim literals and boundary conditions** (append-only from pass-2's perspective). The refined record is written to `mcp-enrichment/...`. Pass-1 on disk is untouched.

### Diff-only execution

- **Added files** — new enrichment records on first encounter; full pass-2.
- **Modified files** — stale enrichment records deleted, new ones written; full pass-2.
- **Renamed files** — old-path enrichment record deleted, new-path enrichment record written.
- **Deleted files** — enrichment records deleted; nothing re-run.
- **Unchanged files** — cached enrichment records kept; no LLM call.
- **First index** — every file in the diff; every enrichment record produced from scratch.

### Failure modes

- Pass-1 record missing for a record in the diff set → the file is skipped with a logged warning; pass-2 cannot run without pass-1.
- Pass-2 LLM call returns unparseable JSON → an empty enrichment record is written, with `_provenance.pass2Notes` describing the failure. A later run may overwrite it.
- Pass-2 LLM call exhausts the 20-tool-call cap → the record is written with whatever facts were gathered, and `_provenance.pass2Notes` records the exhaustion so a later run can retry against a richer graph.
- MCP URL unreachable on the initial probe → strategy fails the job.
- LLM transport / configuration errors → bubble up and fail the job.

---

## What is NOT in this landing

- Flat-folder strategy edits. Its prompt block and `FileAnalysis` shape are untouched.
- Graph-write inside the IR strategy. The IR strategy still produces only disk artifacts; the MCP server the URL points to is expected to be backed by graph-indexing that happens downstream (out of scope here).
- Migration of pre-v2 records. Historical records stay v1 until their files re-enter the diff.
- Unit-level (`CodeUnit`) field changes — v2's reconstruction substrate is added at the file level only.

---

## Code-surface map (no edits in this document)

Pass-0 (folder relocation — prerequisite for pass-1):

- Move file-analysis concerns out of `reconstruction/` into a new sibling `file-analysis/` folder under `intermediate-representation/`. Concretely:
  - `reconstruction/types/**` → `file-analysis/types/**`
  - `reconstruction/prompts/**` (everything pass-1 related; the recreate-and-diff prompt stays) → `file-analysis/prompts/**`
  - `reconstruction/parse/**` → `file-analysis/parse/**`
  - `reconstruction/pipeline/**` → `file-analysis/pipeline/**`
  - `reconstruction/analyzers/**` and `reconstruction/analyzer.ts` → `file-analysis/analyzers/**` and `file-analysis/analyzer.ts`
  - `reconstruction/fingerprint.ts` → `file-analysis/fingerprint.ts`
  - `reconstruction/unit-id.ts` → `file-analysis/unit-id.ts`
- Update every importer (the IR phases, `pass1-reconstruction.ts`, `parse.ts`, `chunking.ts`, `storage.ts`, `index.ts`, and anything in the OSS-submodule consumer tree) to reference the new `#src/strategies/intermediate-representation/file-analysis/...` paths.
- `reconstruction/index.ts` is rewritten to export only the recreate-and-diff surface; the old re-exports of types/prompts/parse are removed.
- `reconstruction/CLAUDE.md` is updated to state the new narrow scope (recreate-and-diff only).

Pass-1 (under the new layout):

- `file-analysis/types/semantics.ts` — add merged v2 fields.
- `file-analysis/types/module-ir.ts` — automatic via `extends SemanticFields`.
- `file-analysis/prompts/file-analysis-fields-v2.ts` — new v2 field block (fork of flat-folder's).
- `file-analysis/prompts/split.ts` — replace shared block reference with the v2 block.
- `file-analysis/prompts/split-fields.ts` — extend snake_case shape with the new keys.
- `file-analysis/parse/analysis-fields.ts`, `parse/module-ir.ts`, `parse/file-split.ts` — narrow new and reshaped fields. Per-field narrowers under `file-analysis/parse/v2/` if needed for the 300-line ceiling.
- `intermediate-representation/phases/analyse-small.ts`, `phases/analyse-big-chunks.ts` — only the import paths change (from `reconstruction/...` to `file-analysis/...`); save path, cache-presence check, and worker pool untouched.
- `intermediate-representation/index.ts` — no edits beyond import-path updates produced by the relocation.

Pass-2:

- `phase2-mcp/` new strategy folder, sibling to `intermediate-representation/` and `flat-folder/`.
- `phase2-mcp/index.ts` — `createPhase2McpStrategy(deps)` factory, returns `IngestStrategy`.
- `phase2-mcp/phases/enrich.ts` — the per-record loop.
- `phase2-mcp/mcp/toolset.ts` — `McpToolset` interface + 20-call wrapper.
- `phase2-mcp/mcp/http-toolset.ts` — HTTP binding to the configured MCP URL.
- `phase2-mcp/storage.ts` — `mcp-enrichment/` reader and writer; uses the encoded-path scheme already used by `fileAnalysisDir` / `bigFileChunksDir`.
- `phase2-mcp/records.ts` — `Phase2EnrichmentRecord` + `_provenance` shape.
- `phase2-mcp/prompts/enrich.ts` + `prompts/enrich-fields.ts` — pass-2 system prompt + JSON shape.
- `phase2-mcp/parse/enrich.ts` — narrows pass-2 LLM JSON into the enrichment record.
- `types/meta-paths.ts` — `MetaPaths` gains `mcpEnrichmentDir`, computed beside the existing dirs.
- `@bb/config` — new keys `Phase2McpUrl`, optional `Phase2McpAuthHeader`.

`context.md` updates:

- `intermediate-representation/context.md` — pass-1 v2 fields added; the `file-analysis/` vs `reconstruction/` split is documented; pass-2 explicitly out of scope here.
- `intermediate-representation/file-analysis/context.md` — new file: responsibilities (types, prompts, parsers, pipeline, analyzers for pass-1 file analysis), public surface, invariants.
- `intermediate-representation/reconstruction/CLAUDE.md` — rewritten to describe the recreate-and-diff loop only; references to file-analysis types/prompts/parsers removed.
- `phase2-mcp/context.md` — new file: tier, responsibilities, public surface, the MCP URL contract, the 20-call cap, the `mcp-enrichment/` layout.

---

## Acceptance criteria

A successful landing requires:

1. **Folder discipline.** No file-analysis types, prompts, parsers, pipeline, or analyzers remain under `reconstruction/`. The verification grep in §"Folder discipline" returns zero matches. `reconstruction/` contains only recreate-and-diff code plus its docs.
2. `SemanticFields` carries every v2 file-level field listed in §"Onto `SemanticFields`", added or reshaped, split across files that each respect the 300-line rule, and lives under `file-analysis/types/`.
3. The forked `FILE_ANALYSIS_FIELDS_BLOCK_V2` describes every new and reshaped field; `SPLIT_JSON_SHAPE` requests every new key. Both live under `file-analysis/prompts/`. Flat-folder's prompt block and `FileAnalysis` shape are unchanged.
4. `analyse-small.ts` and `analyse-big-chunks.ts` produce v2 records on every fresh write; their save paths, cache-presence checks, and worker pools are unchanged. Their imports point at `file-analysis/...`, never `reconstruction/...`.
5. `phase2-mcp/` implements `IngestStrategy`, reads pass-1 records from `MetaPaths`, runs pass-2 per record in the diff set, talks to the MCP URL via the HTTP toolset with the 20-call cap, and writes `mcp-enrichment/<encoded>.json` (and `mcp-enrichment/<encoded>/chunk-N.json`) records carrying `_provenance`.
6. `MetaPaths` exposes `mcpEnrichmentDir`; `@bb/config` exposes `Phase2McpUrl` (and any auth keys).
7. `context.md` for the IR strategy, the new `file-analysis/` folder, and the new `phase2-mcp/` strategy is written or updated in the same change set; `reconstruction/CLAUDE.md` is rewritten to its narrowed scope.
8. Typecheck (`bun run typecheck`) passes. Verification commands in the public submodule's CLAUDE.md for workspace imports, `.ts` extensions, and the absence of `.d.ts` files return zero matches.

Implementation proceeds only after this plan is approved.
