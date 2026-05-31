# `file-analysis` — the IR strategy's file-analysis surface

Tier: **domain** (inside `@bb/ingest-github`). Imports flow downward only: this folder may use
`@bb/llm`, `@bb/errors`, `@bb/logger`, `@bb/mongo` (types), and intra-package `#src/...`. Nothing
in a lower tier may import it.

## Why this folder exists

The IR strategy has one LLM prompt that turns a whole file (or a big-file chunk) into a
structured record: file-level analysis + module IR + a verbatim list of code units. That call,
the prompt that drives it, the JSON shape it asks for, and the parsers that narrow the response
all live here. The reconstruction (recreate-and-diff) loop consumes this output but does NOT
own it — see `../reconstruction/` for that loop.

A second consumer is on the way: the `phase2-mcp` strategy reads these records as its pass-2
input, enriches them across files via MCP tools, and writes a parallel `mcp-enrichment/`
artifact. Pass-2 never mutates pass-1 records on disk.

## Public surface (bare imports — no barrel)

Per project convention (file-analysis ships no `index.ts` barrel), every consumer imports the
bare path:

| Symbol | Path |
| --- | --- |
| `analyseFile`, `AnalyseFileInput` | `./analyse-file.ts` |
| `AnalyseFileResult` | `./types/results.ts` |
| `ModuleIr`, `ImportSymbol`, `UnitDescriptor`, `FileAnalysisResult` | `./types/module-ir.ts` |
| `SemanticFields` | `./types/semantics.ts` |
| `UnitConstant` | `./types/named-constant.ts` |
| `buildUnitId` | `./unit-id.ts` |
| `computeModuleFingerprint`, `canonicalizeConstants` | `./fingerprint.ts` |
| `FILE_ANALYSIS_SYSTEM_PROMPT`, `buildFileAnalysisUserPrompt` | `./prompts/file-analysis.ts` |
| `FILE_ANALYSIS_JSON_SHAPE` | `./prompts/file-analysis-fields.ts` |
| `parseFileAnalysisResult` | `./parse/file-analysis.ts` |
| `parseModuleIr` | `./parse/module-ir.ts` |
| `parseUnitDescriptors` | `./parse/unit-descriptor.ts` |
| `normalizeAnalysisFields` | `./parse/analysis-fields.ts` |
| `parseNamedConstants` | `./parse/named-constants.ts` |
| `asRecord`, `pickBool`, `pickInt`, `pickNumber`, `clamp01`, `pickRecordArray` | `./parse/primitives.ts` |

`ingest-github/src/index.ts` re-exports the consumer-facing subset of these for callers outside
the package.

## Invariants

- The file-analysis call is the only LLM call this folder owns. It returns the JSON shape declared
  in `prompts/file-analysis-fields.ts`; every other key is ignored.
- `parseFileAnalysisResult` is the trust boundary: untrusted LLM JSON enters here and exits as
  `FileAnalysisResult`. No consumer reads raw response keys.
- `ModuleIr.semanticFingerprint` is always written by `computeModuleFingerprint`, never by the
  LLM. The fingerprint is unique per file path so two structurally identical files get distinct
  fingerprints.
- `UnitDescriptor.unitId` is stable: `buildUnitId` is the only producer, and the splitter's
  emitted id is recomputed in code when missing.
- `UnitConstant` is the single shape for both module-level `fileConstants` and per-unit
  `constants`; it lives here (not in reconstruction) so the dep direction stays downward.

## Failure mode

`analyseFile` degrades to an empty `FileAnalysisResult` on unparseable / failed responses; LLM
config and transport errors bubble up so the runner can fail the job.

## What is NOT in this folder

- The recreate-and-diff loop — see `../reconstruction/`.
- Big-file chunking, skim, boundary computation — see `../big-file/` and `../chunking.ts`.
- The IR phases that orchestrate scan / analyse-small / cut / analyse-big-chunks — see
  `../phases/`.
- Cross-file resolution. `UnitDescriptor` carries no resolved import paths; that is the
  `phase2-mcp` strategy's concern (out of scope here).
