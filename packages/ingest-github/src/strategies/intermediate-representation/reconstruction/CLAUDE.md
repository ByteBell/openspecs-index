# CLAUDE.md — `reconstruction` (recreate-and-diff loop)

Tier: **domain** (inside `@bb/ingest-github`). Imports flow downward only: this folder may use
`@bb/llm`, `@bb/errors`, `@bb/logger`, `@bb/mongo` (types), intra-package `#src/...`, and the
sibling `file-analysis/` surface. Nothing in a lower tier may import this folder.

---

## Why this folder exists

Reconstruction is the **round-trip fidelity test** for the IR strategy's output. Given the
pass-1 `FileAnalysisResult` for a file (and, when present, the pass-2 `mcp-enrichment/` record),
the loop tries to **regenerate the file's source from those payloads alone** and **diff it
against the actual file**. A small reconstruction gap means the IR captured enough; a big gap
means a field is missing or wrong, and the diff is the signal we use to fix it.

Everything in this folder serves that loop. **File-analysis types, prompts, and parsers are
not here** — they live in `../file-analysis/`. The split is enforced by the project rule
(see [PLAN-v2-implementation.md](../PLAN-v2-implementation.md) §"Folder discipline"); a
verification grep blocks PRs that put file-analysis concerns under this folder.

---

## The loop

The round-trip runs per unit (a function, class, struct, contract, modifier, …):

```text
unit's verbatim source ──► UNIT-IR call ──► CodeUnit (reconstruction IR)
                                              │
                                              ├──► REGENERATE call ──► regenerated source
                                              │                              │
                                              └──► EQUIVALENCE call ◄────────┘
                                                            │
                                                            ▼
                                              { semanticEquivalent,
                                                missingFromIr[],
                                                reconstructionCompleteness }
```

If `semanticEquivalent === false`, the UNIT-IR call retries ONCE with `missingFromIr` as
MUST-CAPTURE hints, then re-verifies. The finalised unit's `semanticFingerprint` is computed in
code, never by the LLM (file-path-unique sha256 over identity + signature + logic outline + I/O
spec + sorted constants).

The whole-file orchestrator (`pipeline/analyze-file.ts`) consumes a pass-1 split, walks the
units, and assembles a `FileReconstructionResult` with the mean per-unit completeness.

---

## Folder map

| File | Responsibility |
| --- | --- |
| `analyzer.ts` | `createReconstructionAnalyzer()` — facade exposing the unit-IR / verify / pipeline methods. Does NOT expose the file-analysis call. |
| `index.ts` | Public barrel. Re-exports the facade, phase inputs, result envelopes, unit IR types, equivalence types, the unit fingerprint, and the file→records helper. |
| `prompts/unit-ir.ts` + `unit-ir-fields.ts` | UNIT-IR system prompt + JSON shape + user builder (carries MUST-CAPTURE retry hints). |
| `prompts/verify.ts` | Regenerate prompt + equivalence prompt. |
| `parse/code-unit.ts` | Composes the per-field narrowers into a `CodeUnit` (fingerprint left empty). |
| `parse/unit-fields.ts` | Per-field narrowers — parameters, calls, members, verbatim blocks, I/O pairs, error policy. |
| `parse/logic-outline.ts` | Recursive SCoT outline narrower (depth-capped). |
| `parse/verification.ts` | Equivalence response → `EquivalenceReport`. |
| `analyzers/extract-unit-ir.ts` | UNIT-IR call. |
| `analyzers/regenerate-unit.ts` | REGENERATE call (raw code, `askLLM`). |
| `analyzers/verify-equivalence.ts` | EQUIVALENCE call. |
| `analyzers/verify-unit.ts` | Regenerate + equivalence combined. |
| `pipeline/analyze-unit.ts` | Per-unit: extract → verify → ≤1 retry → fingerprint. |
| `pipeline/analyze-file.ts` | Whole-file orchestrator: consume file-analysis split → analyze each unit → assemble result. |
| `pipeline/file-records.ts` | Whole-file → persist-ready module record + keyed `codeUnits` map. |
| `pipeline/resolution-context.ts` | Imports + sibling-signature digest fed into the unit-IR prompt. |
| `fingerprint.ts` | `computeUnitFingerprint` (the module fingerprint lives in `file-analysis/fingerprint.ts`). |
| `types/code-unit.ts` | `CodeUnit` + sub-shapes (`LogicStep`, `ErrorPolicy`, `UnitCall`, `UnitMember`, `CodeUnitParameter`, `VerbatimBlock`, `ExampleIoPair`). Re-exports `UnitConstant` from `file-analysis/`. |
| `types/verification.ts` | `EquivalenceReport`, `UnitVerification`. |
| `types/results.ts` | `UnitIrResult`, `VerifyUnitResult`, `UnitReconstruction`, `FileReconstructionResult`. (`AnalyseFileResult` lives in `file-analysis/types/results.ts`.) |

---

## Dependency direction

Reconstruction imports from `file-analysis/` (downward). Everything reconstruction needs from
file-analysis is bare-path imported from `#src/strategies/intermediate-representation/file-analysis/...`:

- `ModuleIr`, `UnitDescriptor`, `ImportSymbol`, `FileAnalysisResult` from `file-analysis/types/module-ir.ts`
- `UnitConstant` from `file-analysis/types/named-constant.ts` (re-exported by `types/code-unit.ts` for convenience)
- `analyseFile` from `file-analysis/analyse-file.ts` (used by `pipeline/analyze-file.ts` and `pipeline/file-records.ts` as the upstream split call)
- `computeModuleFingerprint`, `canonicalizeConstants` from `file-analysis/fingerprint.ts`
- `asRecord`, `pickBool`, `pickInt`, `pickNumber`, `clamp01`, `pickRecordArray` from `file-analysis/parse/primitives.ts`
- `parseNamedConstants` from `file-analysis/parse/named-constants.ts`

The reverse direction is forbidden: `file-analysis/` never imports from `reconstruction/`.

---

## Scope boundary — persistence is the caller's job

This folder **produces** validated, fingerprinted IR and equivalence reports. It does **not**
write Neo4j or Mongo. The persistence MERGEs and edges belong to the graph / indexing tier,
which consumes the records from `analyzeFile` / `analyzeFileToRecords`. Keeping writes out
preserves tier direction and keeps the loop pure and testable.

---

## Rules that bite here

- **300-line file ceiling** — every file is one concern; split before adding.
- **No `any`** — LLM JSON enters as `unknown`, narrowed in `parse/`.
- **`#src/...` and `@bb/...` imports only**, `.ts` extensions, no `../` traversal.
- **No file-analysis types, prompts, or parsers may appear under this folder.** Verification
  grep in [PLAN-v2-implementation.md](../PLAN-v2-implementation.md) §"Folder discipline" must
  return zero matches.
- **Additive schema** — new `unitKind`s and fields extend the open vocabulary; never repurpose
  an existing field's meaning.
- **Terminology** — a *prompt* is what we send; a *response* is what the model returns.
  Parsers narrow responses, never "parse prompts". Phases are: the **unit-IR call**, the
  **regenerate call**, and the **equivalence call**.
- **Update this file** whenever the loop's flow, prompts, or stored shapes change.
