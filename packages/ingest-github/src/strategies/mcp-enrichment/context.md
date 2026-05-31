# `mcp-enrichment` strategy

Tier: **domain** (inside `@bb/ingest-github`). Imports flow downward only: this folder may use
`@bb/llm`, `@bb/errors`, `@bb/logger`, `@bb/config`, `@bb/types`, and intra-package `#src/...`.
Nothing in a lower tier may import it.

## Why this strategy exists

The IR strategy's file-analysis call produces a rich semantic record per file (and per big-file
chunk) — but some fields it cannot fill from the file alone: which file is an `importsInternal`
spec actually pointing at? Where is `contractsConsumed[i]` defined? What clears the
`ambiguities[]` the analyzer flagged?

`mcp-enrichment` answers those cross-file questions by talking to an MCP server (URL configured
via `Config.McpEnrichmentUrl`) and writing a parallel **enrichment record** per file/chunk.
The original file-analysis records on disk are **never mutated** — consumers read the two
side-by-side via the same encoded path.

## Storage layout

Mirrors `fileAnalysisDir/<encoded>.json` and `bigFileChunksDir/<encoded>/chunk-N.json`:

```text
mcpEnrichmentDir/
  <encoded>.json                 # one per small file
  <encoded>/chunk-N.json         # one per big-file chunk
```

`MetaPaths.mcpEnrichmentDir` is created by `ensureMetaDirs`. Encoded paths come from the same
`encodeMetaPath` helper the IR strategy uses, so the enrichment record for a file-analysis
record at `fileAnalysisDir/foo__SL__bar.json` lives at `mcpEnrichmentDir/foo__SL__bar.json`.

## Public surface

| Symbol | Path |
| --- | --- |
| `createMcpEnrichmentStrategy`, `McpEnrichmentStrategyDeps` | `./index.ts` |
| `McpEnrichmentRecord`, `EnrichmentProvenance`, `FieldProvenance`, `McpToolCallLog`, `McpToolName` | `./records.ts` |
| `saveSmallEnrichment`, `saveChunkEnrichment`, `readSmallEnrichmentIfPresent`, `readChunkEnrichmentIfPresent`, `hasSmallEnrichment`, `hasChunkEnrichment`, `deleteSmallEnrichment`, `deleteAllChunkEnrichments` | `./storage.ts` |
| `McpToolset`, `McpToolResult`, `McpCallLogBuffer`, `DEFAULT_MCP_BUDGET`, `createMcpCallLogBuffer`, `withBudget` | `./mcp/toolset.ts` |
| `createHttpMcpToolset`, `probeMcp`, `HttpMcpToolsetConfig` | `./mcp/http-toolset.ts` |
| `runEnrichForRecord`, `MAX_ROUNDS`, `EnrichForRecordInput` | `./phases/enrich.ts` |
| `listEnrichmentTargets`, `EnrichmentTarget` | `./phases/list-records.ts` |

## Configuration

- `Config.McpEnrichmentUrl` — **required**. Strategy fails the job at startup if empty.
- `Config.McpEnrichmentAuthHeader` — optional. Sent as the `Authorization` header on every
  MCP request when set.

## Tool budget

Each file/chunk is granted **20 MCP tool calls total** (`DEFAULT_MCP_BUDGET`). The budget is
enforced by `withBudget`, which wraps an `McpToolset`. Once 20 calls have been attempted, every
subsequent call short-circuits to `{ ok: false, budgetExhausted: true }` and the call-log
buffer's `budgetExhausted` flag is set so the agent loop knows to stop asking.

Counts attempts, not successes — a transport failure still consumes one slot.

## Agent loop

`@bb/llm` does not support native tool-use, so each record's enrichment runs as a
**multi-round agent loop** (`phases/enrich.ts`):

```text
round 1..MAX_ROUNDS (= 4):
  ↓
  askJsonLLM(ENRICH_SYSTEM_PROMPT, buildEnrichUserPrompt(...))
  ↓
  parseEnrichResponse → { toolRequests, enrichmentJson, fieldChanges, enrichmentNotes, done }
  ↓
  for each toolRequest (until budget exhausted):
     dispatch through budget-capped toolset
  ↓
  merge enrichmentJson into accumulator; record fieldChanges + notes
  ↓
  stop when done === true OR budgetExhausted OR rounds run out
```

## Per-record flow

1. Read the file-analysis record from disk (`fileAnalysisDir/<encoded>.json` or
   `bigFileChunksDir/<encoded>/chunk-N.json`).
2. Read the verbatim source via the strategy's `SourceReader`.
3. For big-file chunks: read every OTHER chunk's file-analysis record (siblings) and feed them
   into the prompt as context.
4. Create a budget-capped MCP toolset.
5. Run the agent loop; assemble the enrichment record.
6. Write `mcpEnrichmentDir/<encoded>.json` (or chunk path).

## Failure modes

- **MCP URL missing / unreachable** at startup → strategy fails the job (config error).
- **File-analysis record missing** for a listed target → that target is skipped with a
  warning; never blocks other targets.
- **Source unreadable** → target skipped with a warning.
- **Unparseable LLM JSON** → enrichment record is written with whatever was gathered + an
  `enrichmentNotes` entry recording the parse failure.
- **20-call budget exhausted** → enrichment record is written with `budgetExhausted: true`
  and the model's last `enrichmentNotes` explaining which fields it would have refined next.
- **LLM transport / config error** → bubbles up; strategy fails the job per IR convention.

## Invariants

- The file-analysis records on disk are **never** mutated.
- Pass-2 may refine any semantic field EXCEPT `verbatimLiterals` and `boundaryConditions`,
  which are append-only here.
- `_provenance.mcpToolCalls` is the audit trail — one entry per attempted tool call (success
  or failure), in order.
- `_provenance.fields` lists ONLY fields this run wrote or changed; carryovers from the
  file-analysis record don't appear there.

## Diff-only execution

This landing implements **full enrichment** for every file-analysis record on disk. The plan
calls for diff-only execution (added / modified / renamed → enrich; unchanged → keep cached;
deleted → drop enrichment). That is a future refinement; today the strategy walks every record
and overwrites enrichments in place.
