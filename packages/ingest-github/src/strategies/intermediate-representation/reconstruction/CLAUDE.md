# CLAUDE.md — `intermediate-representation` strategy

Tier: **domain** (inside `@bb/ingest-github`). Imports flow downward only: this folder may use
`@bb/llm`, `@bb/errors`, `@bb/logger`, `@bb/mongo` (types), and intra-package `#src/...`. Nothing
in a lower tier may import it.

---

## Why this folder exists

`flat-folder` (the sibling strategy) analyses a small file in one call and, for a big file,
**condenses** every chunk's analysis down into a single summary `FileAnalysis`. That is lossy by
design — built for retrieval, not reproduction.

`intermediate-representation` is the **detail-preserving** counterpart. It holds **two
independent paths**, each a different "intermediate representation" of a (usually large) file:

1. **Big-file chunk path** — boundary-aware chunking + per-chunk deep analysis, stored
   chunk-by-chunk **without** condensation.
2. **Reconstruction-grade IR path** (`./reconstruction/`) — a structured, regenerable IR of
   every code unit, gated by a code → IR → code round-trip.

Neither path imports the other. Both can run against the same big file.

> Status: both paths are built up to their analysis layer. The `IngestStrategy` wiring (the
> `createXStrategy` + worker registration) is still in progress, which is why nothing outside
> this folder imported it until the reconstruction analyzer was exported from the package index.

---

## Path 1 — Big-file chunk path (boundary-aware, no condensation)

Splitting a huge file on a raw token budget cuts through the middle of declarations and analyses
each piece blind to the rest. This path finds **real** boundaries and analyses each chunk **with
a map of the whole file injected**, then persists every chunk record verbatim.

```
big file
  ├─ SKIM (1 call/window)        split into windows (chunking.ts), summarise each into a THIN
  │                              outline: declarations w/ VERBATIM first-line signatures + imports.
  ├─ FILE_MAP_MERGE (1 call)     collapse the window outlines into ONE file-level analysis + a
  │                              global declaration index  →  FileMap.
  ├─ boundary cut                locate declarations by their verbatim signatures and cut at real
  │                              boundaries (splitByTokenBudget is the fallback splitter).
  └─ AWARE_CHUNK (1 call/chunk)  deep-analyse each chunk WITH the FileMap injected; file-level
                                 fields copied from the map, classes/functions/sectionMap local.
                                    └─ store one IrChunkRecord per chunk AS-IS — NO condensation.
```

| File | Responsibility |
|---|---|
| `chunking.ts` | `splitByTokenBudget` — token-budget line splitter (windows + boundary fallback). |
| `types.ts` | `OutlineDeclaration`, `SkimWindowOutline`, `FileMap`, `IrChunkRecord`. |
| `parse.ts` | Defensive narrowers + token accounting (`TokenUsage`, `addUsage`, `ZERO_USAGE`, `pickString`, `pickStringArray`). **Shared with Path 2.** |
| `prompts/skim.ts` | Skim window prompt. |
| `prompts/aware-fields.ts` | Flat camelCase JSON shapes for skim / merge / deep. |
| `prompts/aware-chunk.ts` | File-map merge prompt + context-aware deep-chunk prompt. |

Invariants: skim `signature` is the verbatim first line (the AST-free locator — never paraphrase);
file-level fields are written once from the FileMap and identical across chunks; chunk records are
stored as-is and never condensed.

---

## Path 2 — Reconstruction-grade IR (`./reconstruction/`)

The unit of work is a generic **`CodeUnit`** with an OPEN `unitKind` (`function`, `method`,
`class`, `struct`, `enum`, `trait`, `impl`, `interface`, `contract`, `library`, `modifier`,
`event`, `module`, `macro`, `type_alias`, …) — never a hardcoded class/function split. Fields are
ADAPTIVE: behavioral kinds fill the logic fields; container/type kinds fill the membership fields.

Three LLM phases keep each call's context small, then a round-trip gates fidelity:

```
file
  ├─ SPLIT call (1/file)     whole file → (a) FILE-LEVEL analysis, (b) module structure,
  │                          (c) a list of units, each with VERBATIM source + span. Container
  │                          units emit both themselves and their children (parentUnitId set).
  └─ for each unit:
        ├─ UNIT-IR call (1/unit)  one unit's source → its reconstruction IR (signature,
        │                         parameters, logicOutline (SCoT), constants, errorPolicy,
        │                         calls, members, verbatimBlocks, exampleIoPairs, …).
        ├─ VERIFY phase:
        │     ├─ regenerate call   IR → regenerated source (code only).
        │     └─ equivalence call  original vs regenerated → { semanticEquivalent,
        │                          missingFromIr[], reconstructionCompleteness }.
        └─ if NOT equivalent → re-run the UNIT-IR call ONCE with missingFromIr as MUST-CAPTURE
                               hints, then re-verify. Finally compute the fingerprint IN CODE.
```

### Where the flat-folder fields live — FILE level, not per unit

A file has many code units, so the flat-folder semantic analysis (purpose, summary,
businessContext, keywords, ontologyConcepts, businessEntities, systemCapabilities, sideEffects,
configDependencies, dataFlowDirection, integrationSurface, contractsProvided, contractsConsumed,
sectionMap, classes, functions, imports) belongs **once on the file**. It is modelled as
`SemanticFields` (`types/semantics.ts`) and **`ModuleIr extends SemanticFields`**, so those fields
are DIRECT members of the module node — not a nested `FileAnalysis` object, and not duplicated on
every unit. The SPLIT call emits them at the top level of its response; `parse/analysis-fields.ts`
reuses the existing `shapeAnalysis()` shaper so the narrowing logic stays single-sourced. This
makes the file-level reconstruction IR a strict SUPERSET of the flat-folder output.

Each `CodeUnit` carries only its reconstruction IR — no semantic-analysis fields.

### Computed IN CODE, never by the LLM

- **`semanticFingerprint`** — sha256 over the **file path** + identity + signature + serialized
  `logicOutline` + `ioFormatSpec` + sorted `constants` (unit), or file path + layout / exports /
  top-level code / file constants (module). The file path is folded in so the fingerprint is
  UNIQUE per file; a non-empty fingerprint is the marker that a unit/module has been computed
  (`""` = not yet). `fingerprint.ts`.
- **Identity & spans** — `unitId`, `unitKind`, `name`, `qualifiedName`, `parentUnitId`,
  `startLine`, `endLine` come from the trusted split descriptor, not restated by the unit-IR call.

### The LLM contract is snake_case; the IR is camelCase

The prompts ask for the spec's snake_case keys (`logic_outline`, `error_policy`, …). The `parse/`
layer is the trust boundary: it narrows that untrusted JSON into the camelCase `CodeUnit` /
`ModuleIr`. **No LLM output is used before it passes through `parse/`.**

### Folder map (`./reconstruction/`)

| Folder / file | Responsibility |
|---|---|
| `types/code-unit.ts` | `CodeUnit` + sub-shapes (`LogicStep`, `ErrorPolicy`, `UnitCall`, `UnitMember`, `CodeUnitParameter`, `UnitConstant`, `VerbatimBlock`, `ExampleIoPair`). |
| `types/module-ir.ts` | `ModuleIr` (extends `SemanticFields`), `ImportSymbol`, `UnitDescriptor`, `FileSplit`. |
| `types/semantics.ts` | `SemanticFields` — the flat-folder fields, flattened for `extends`. |
| `types/verification.ts` | `EquivalenceReport`, `UnitVerification`. |
| `types/results.ts` | Per-phase + whole-file result envelopes (each carries `TokenUsage`). |
| `prompts/split.ts` + `split-fields.ts` | SPLIT system prompt + JSON shape + user builder. |
| `prompts/unit-ir.ts` + `unit-ir-fields.ts` | UNIT-IR system prompt + JSON shape + user builder (MUST-CAPTURE retry hints). |
| `prompts/verify.ts` | Regenerate + equivalence prompts. |
| `parse/primitives.ts` | `asRecord`, `pickBool`, `pickInt`, `pickNumber`, `clamp01`, `pickRecordArray`. |
| `parse/named-constants.ts` | `{name,value,kind}` parser shared by file + unit constants. |
| `parse/analysis-fields.ts` | Bridges `shapeAnalysis` → `SemanticFields`. |
| `parse/logic-outline.ts` | Recursive SCoT outline narrower (depth-capped). |
| `parse/unit-fields.ts` | Per-field narrowers (parameters, calls, members, verbatim, io pairs, error policy). |
| `parse/code-unit.ts` | Composes them into a `CodeUnit` (empty fingerprint). |
| `parse/module-ir.ts` | Module structural fields + merged `SemanticFields`. |
| `parse/unit-descriptor.ts` | The `units` list → `UnitDescriptor[]`. |
| `parse/file-split.ts` | Top-level split-response narrower → `FileSplit`. |
| `parse/verification.ts` | Equivalence-response narrower → `EquivalenceReport`. |
| `fingerprint.ts` | `computeUnitFingerprint`, `computeModuleFingerprint` (file-path-unique). |
| `unit-id.ts` | `buildUnitId` — `{fileNodeId}#{unitKind}:{qualifiedName}`. |
| `analyzers/analyse-file.ts` | File-analysis call (a.k.a. SPLIT phase). |
| `analyzers/extract-unit-ir.ts` | UNIT-IR call. |
| `analyzers/regenerate-unit.ts` | Regenerate call (raw code, `askLLM`). |
| `analyzers/verify-equivalence.ts` | Equivalence call. |
| `analyzers/verify-unit.ts` | Regenerate + equivalence combined. |
| `analyzers/usage.ts` | LLM-usage → `TokenUsage` projection. |
| `pipeline/analyze-unit.ts` | Per-unit: extract → verify → ≤1 retry → fingerprint. |
| `pipeline/analyze-file.ts` | Whole-file: split → each unit → fingerprinted, persist-ready result. |
| `pipeline/resolution-context.ts` | Imports + sibling-signature digest for unit-IR calls. |
| `analyzer.ts` + `index.ts` | The exposed `ReconstructionAnalyzer` facade + barrel. |

---

## Exposed interface (Path 2)

`./reconstruction/index.ts` is the public surface (re-exported from the package `index.ts`, so it
is callable from other packages). `createReconstructionAnalyzer()` returns a `ReconstructionAnalyzer`
whose methods map one-to-one to the phases — a caller can run the whole file or step one phase:

- `analyseFile(input)` — file-analysis call (a.k.a. SPLIT phase).
- `extractUnitIr(input)` — UNIT-IR call (one unit).
- `verifyUnit(input)` — VERIFY phase (regenerate + equivalence).
- `analyzeUnit(input)` — per-unit pipeline (extract → verify → retry → fingerprint).
- `analyzeFile(input)` — full orchestration; returns fingerprinted `CodeUnit`s + `ModuleIr`.

Every method returns its `TokenUsage` for metering.

---

## Scope boundary — persistence is the caller's job

This folder **produces** validated, fingerprinted IR. It does **not** write Neo4j or Mongo. The
`CodeUnit` / `FileNode` MERGEs, index creation, and `HAS_UNIT` / `CONTAINS_UNIT` / `CALLS` /
`IMPLEMENTS` / `EXTENDS` edges belong to the graph/indexing tier, which consumes the records from
`analyzeFile`. Keeping writes out preserves tier direction and keeps the analyzer pure and testable.

---

## Rules that bite here

- **300-line file ceiling** — every file is one concern; split before adding.
- **No `any`** — LLM JSON enters as `unknown`, narrowed in `parse/`.
- **`#src/...` and `@bb/...` imports only**, `.ts` extensions, no `../` traversal.
- **Additive schema** — new `unitKind`s and fields extend the open vocabulary; never repurpose an
  existing field's meaning.
- **Terminology** — a *prompt* is what we send; a *response* is what the model returns. Parsers
  narrow responses, never "parse prompts". Phases are: the **split call**, the **unit-IR call**,
  and the **verify phase** (regenerate call + equivalence call).
- **Update this file** whenever either path's flow, prompts, or stored shapes change.
