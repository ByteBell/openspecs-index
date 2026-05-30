# context.md — IR `big-file` analyzer

Tier: **domain** (inside `@bb/ingest-github`, under the `intermediate-representation` strategy).
Imports flow downward only: `@bb/llm`, `@bb/errors`, `@bb/logger`, `@bb/config`, `@bb/types`,
`@bb/mongo` (the `FileAnalysis` shape), and intra-package `#src/...`. Nothing in a lower tier may
import it. **It borrows nothing from the `flat-folder` strategy** — the IR path owns its chunk
analysis end to end.

## Why this folder exists

The detail-preserving counterpart to flat-folder's big-file path. flat-folder's `processBigFile`
chunks a large file, analyses each chunk, then **condenses** all chunk analyses into a single
summary `FileAnalysis`. This folder does context-aware chunking + per-chunk analysis but **never
condenses** — every chunk's analysis is kept verbatim as an `IrChunkRecord` for the caller to persist.

## Flow

```
big file
  ├─ SKIM      splitByTokenBudget cuts the file into windows (chunking.ts); skim each window
  │            (skim.ts) into a thin outline — declarations + verbatim signatures + a region summary.
  ├─ LOCATE    locateDeclarations (declarations.ts) resolves each declaration's start line by
  │            matching its verbatim signature in the source; chunkByDeclarations cuts the file
  │            into analysis chunks AT those declaration starts under the token budget (no LLM, no
  │            split declaration). renderFileMapDigest (file-map.ts) assembles the FILE_MAP digest
  │            in code — region overview + declaration index (which chunk each declaration is in).
  └─ AWARE     analyzeAwareChunk (chunk-analyzer.ts) deep-analyses each chunk WITH the digest →
               one IrChunkRecord per chunk. NO condensation, NO file-level merge call.
```

Each chunk of one file shares `relativePath` but gets a distinct `fileId` =
`${fileNodeId}:L${startLine}-${endLine}`.

## Public interface

`createIrBigFileAnalyzer()` → `IrBigFileAnalyzer`:

- `isBigFile(content)` — `tokenLen(content) > Config.ContextWindowLimit`.
- `analyzeBigFile(input)` — skim → locate → cut chunks → aware-analyze; returns
  `{ chunks: IrChunkRecord[], tokenUsage, ... }`. `input` carries `fileNodeId` so chunks derive their ids.

Re-exported from the package `index.ts`.

## Files

| File | Responsibility |
|---|---|
| `skim.ts` | `skimWindow` — SKIM one window into a `SkimWindowOutline` (degrades to an empty outline). |
| `declarations.ts` | `locateDeclarations` (signature → start line) + `chunkByDeclarations` (cut at declaration starts under the token budget; falls back to a plain token-budget split). |
| `file-map.ts` | `renderFileMapDigest` — assemble the FILE_MAP digest in code from outlines + located decls + chunks. |
| `chunk-analyzer.ts` | `analyzeAwareChunk` — AWARE_CHUNK deep analysis of one chunk WITH the digest. |
| `analyzer.ts` | `createIrBigFileAnalyzer` facade — orchestrates skim → locate → cut → aware. |
| `index.ts` | Public barrel. |

## Invariants

- **No condensation** — chunk records are stored as-is; this is the whole point of the path.
- **No flat-folder reuse** — the IR strategy owns its skim/locate/aware chunk analysis; it does not
  import flat-folder's `analyzeChunk` or any other sibling-strategy internal.
- **Chunks cut on declarations** — a chunk boundary only ever falls on a located declaration start,
  so no declaration is split across chunks. Cutting is deterministic (no LLM) once the skim is done.
- **Distinct chunk ids, shared path** — `fileId = ${fileNodeId}:L${start}-${end}`; `relativePath` is shared.
- **Pure analyzer** — no disk / Neo4j / Mongo writes; the caller persists the records.
- **Degrade safe** — unparseable / failed skim and aware calls fall back to empty outlines / results;
  LLM config / transport errors bubble up so the caller can fail the job.

## External dependencies

`@bb/llm` (`askJsonLLM`, `tokenLen`), `@bb/config` + `@bb/types` (`Config.MaxTokensPerChunk`,
`Config.ContextWindowLimit`), `@bb/mongo` (`FileAnalysis`), `@bb/errors` (`LlmConfigError`/`LlmError`
bubble up), `@bb/logger`. Shared intra-package: `shapeAnalysis` (`#src/adapters/llm-file-analyzer.ts`),
`emptyFileAnalysis` / `FALLBACK_LANGUAGE` (`#src/types/file-analysis.ts`), the IR `parse.ts` usage helpers,
and the IR `prompts/` (`skim.ts`, `aware-chunk.ts`).
