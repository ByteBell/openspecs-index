# `intermediate-representation` strategy

Tier: **domain** (inside `@bb/ingest-github`). Imports flow downward only — this folder may use
`@bb/llm`, `@bb/errors`, `@bb/logger`, `@bb/config`, `@bb/mongo` (types), and intra-package
`#src/...`. Nothing in a lower tier may import it.

## Why this strategy exists

Flat-folder analyses every small file with one LLM call and condenses each big file's chunks
into a single summary. That is built for cheap retrieval, not for downstream graph / IR work.

The IR strategy uses the SAME analysis prompt for every unit of code it sees — small file or big
file chunk — and stores each response **verbatim**. The analysis response is a
`FileAnalysisResult` (module-level fields plus the verbatim list of code units with line spans);
the IR strategy never analyses those units further. Reconstruction is a separate concern (it
extracts per-unit IRs from these units) and is **not** run from this strategy.

## Phases

Phases run in this fixed order. Each one persists its output to disk before the next starts, so
re-runs resume from the most recent completed phase (and skip files whose output is already on
disk).

```
1. scan-and-classify       walk + token-classify every eligible file into the scan manifest.
                           Writes:  metaPaths.scanManifestJson  (shared shape with flat-folder)

2. analyse-small           for every `small` entry in the manifest, run ONE file-analysis call
                           and persist the result.
                           Writes:  metaPaths.fileAnalysisDir/<encoded>.json
                                    one IrFileAnalysisRecord per small file

3. compute-boundaries      for every `big` entry, SKIM each token-budget window and LOCATE
                           every declaration's start line (verbatim signature match).
                           Writes:  metaPaths.bigFileAnalysisDir/<encoded>.boundaries.json
                                    one IrBigFileBoundaries per big file

4. cut-big-files           pure / no LLM. Read boundaries; cut the file into analysis chunks at
                           declaration starts (whole declarations only, never split).
                           Writes:  metaPaths.bigFileChunksDir/<encoded>/chunk-1.raw.json
                                    chunk-2.raw.json, …  (1-indexed)

5. analyse-big-chunks      for every raw chunk, run the SAME file-analysis call used for small
                           files; persist each result as-is.
                           Writes:  metaPaths.bigFileChunksDir/<encoded>/chunk-1.json
                                    chunk-2.json, …  (1-indexed)
                                    relativePath in the record = the parent file's path
```

Nothing else runs from here. No folder summary, no repo summary, no Neo4j writes, no
reconstruction.

## Inputs / outputs

| Phase                | Reads                                                  | Writes                                        |
| -------------------- | ------------------------------------------------------ | --------------------------------------------- |
| scan-and-classify    | source reader (walk)                                   | `scan-manifest.json`                          |
| analyse-small        | `scan-manifest.json`, source `readFile`                | per-file `IrFileAnalysisRecord` JSON          |
| compute-boundaries   | `scan-manifest.json`, source `readFile`                | per-file `<x>.boundaries.json`                |
| cut-big-files        | `scan-manifest.json`, `<x>.boundaries.json`, source    | per-chunk `chunk-N.raw.json`                  |
| analyse-big-chunks   | `scan-manifest.json`, `chunk-N.raw.json`               | per-chunk `chunk-N.json`                      |

## Storage

The strategy reuses the existing `MetaPaths` (shared with flat-folder). Per-file filenames are
encoded with `encodeMetaPath` so slashes survive a flat layout. The chunk number lives in the
filename only — the IR strategy does **not** roll chunks up into a per-file manifest, and each
chunk record carries the parent file's `relativePath`.

## Naming

- The file-analysis function is `analyseFile` (from `reconstruction/analyzers/analyse-file.ts`).
  The reconstruction layer's whole-file pipeline (`pipeline/analyze-file.ts`) keeps the American
  spelling `analyzeFile`; the two are distinguished by spelling — `analyseFile` is the single LLM
  call, `analyzeFile` is the whole-file orchestrator.
- The result shape is `FileAnalysisResult` (renamed from `FileSplit` in
  `reconstruction/types/module-ir.ts`); it is what gets persisted as `analysis` on every record.

## Invariants

- Every persisted record is JSON, written atomically through `node:fs/promises`.
- A file or chunk whose record already exists on disk is skipped on re-run.
- The chunk number is encoded **only** in the filename (`chunk-1.json`, `chunk-2.json`, …).
- The chunks of one big file share the parent's `relativePath`.
- The IR strategy never modifies prompts — it reuses the file-analysis prompt as-is.

## Files

| File                                    | Responsibility                                          |
| --------------------------------------- | ------------------------------------------------------- |
| `index.ts`                              | Strategy facade. `createIrStrategy()` returns an `IngestStrategy`. |
| `records.ts`                            | Persisted record types (`IrFileAnalysisRecord`, `IrBigFileBoundaries`, `IrBigFileChunkRaw`). |
| `storage.ts`                            | Disk I/O — save / read / list helpers for every record. |
| `phases/scan-and-classify.ts`           | Phase 1.                                                |
| `phases/analyse-small.ts`               | Phase 2.                                                |
| `phases/compute-boundaries.ts`          | Phase 3.                                                |
| `phases/cut-big-files.ts`               | Phase 4 (pure).                                         |
| `phases/analyse-big-chunks.ts`          | Phase 5.                                                |
| `big-file/skim.ts`, `big-file/declarations.ts`, `chunking.ts` | Reused by phases 3 + 4.        |
| `reconstruction/`                       | Untouched. Not orchestrated by this strategy.           |
