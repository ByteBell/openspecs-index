# `@bb/ingest-core/src/prompts`

The per-file LLM analysis prompts shared by every strategy and big-file driver.
Each module exports a frozen system-prompt string plus a pure user-prompt
builder. The prompts are the contract for the JSON the LLM must return; all of
them mandate "return ONLY a JSON object, no prose, no markdown fences" and reuse
the single canonical field block so every analysis surface agrees on key names
and semantics.

## Files

- `file-analysis-fields.ts` — `FILE_ANALYSIS_FIELDS_BLOCK`: the **single source
  of truth** for the analysis schema — the per-field definitions (`purpose`,
  `summary`, `businessContext`, `language`, `classes`, `functions`,
  `importsInternal/External`, `keywords`, `ontologyConcepts`,
  `businessEntities`, `systemCapabilities`, `sideEffects`,
  `configDependencies`, `dataFlowDirection`, `integrationSurface`,
  `contractsProvided/Consumed`, `sectionMap`). Imported by the file-analysis,
  chunk, and condense prompts so all three describe the same fields.
- `file-analysis.ts` — `COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT` +
  `buildFileAnalysisUserPrompt({ relativePath, content })`. The whole-file
  analysis prompt used by the small-file phase.
- `chunk.ts` — `CHUNK_ANALYSIS_SYSTEM_PROMPT` + `buildChunkUserPrompt(...)`. The
  per-chunk variant for big files: analyses ONE chunk in isolation, carrying
  chunk index / total / line range.
- `condense.ts` — `CONDENSE_SYSTEM_PROMPT` + `buildCondenseUserPrompt(...)`.
  Merges N partial chunk analyses into one file-level analysis, applying the
  embedded merge rules (dedupe, keep-public-only, per-field caps) on top of the
  shared field block.
- `backfill.ts` — `BACKFILL_SYSTEM_PROMPT` + `buildBackfillUserPrompt(...)`.
  Fills only the missing extended fields on an already-analysed file from its
  existing purpose/summary/classes/functions/imports.

## Public interface

Re-exported from the package barrel (`#src/index.ts`):
`COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT`, `buildFileAnalysisUserPrompt`,
`FILE_ANALYSIS_FIELDS_BLOCK`, `BACKFILL_SYSTEM_PROMPT`, `buildBackfillUserPrompt`,
`CHUNK_ANALYSIS_SYSTEM_PROMPT`, `buildChunkUserPrompt`, `CONDENSE_SYSTEM_PROMPT`,
`buildCondenseUserPrompt`.

## Imports allowed

- Sibling files in this folder only (the chunk/condense/file-analysis prompts
  import `./file-analysis-fields.ts`).
- No `@bb/*`, no `node:*`, no `#src/...`. These are pure string/template
  modules with zero runtime dependencies.

## Invariants

- `FILE_ANALYSIS_FIELDS_BLOCK` is defined once; the file-analysis, chunk, and
  condense prompts must compose it rather than restating field definitions, so
  the JSON contract never drifts between surfaces.
- User-prompt builders are pure — same input, same string; they perform no I/O
  and read no config.
- Prompts describe the contract only; schema validation and normalisation of
  the LLM's response happen in the calling phase, never here.
