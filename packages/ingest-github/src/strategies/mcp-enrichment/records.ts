/**
 * On-disk record shape the `mcp-enrichment` strategy persists. One shape covers both small
 * files and big-file chunks (the chunk number is encoded in the filename only). The original
 * file-analysis records on disk are NEVER mutated — these records are a parallel surface keyed
 * by the same encoded path, and downstream consumers read the two side-by-side.
 *
 * Storage layout:
 * - Small file: `mcpEnrichmentDir/<encoded>.json`
 * - Big-file chunk: `mcpEnrichmentDir/<encoded>/chunk-N.json`
 *
 * Every record carries its `_provenance`: per-changed-field origin + reason, the full MCP
 * tool-call log, any `enrichmentNotes` for fields the run could not resolve, and the
 * `budgetExhausted` flag set when the 20-call cap triggered.
 */
import type { TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { SemanticFields } from "#src/strategies/intermediate-representation/file-analysis/types/semantics.ts";

/** Closed enum of MCP tools the enrichment LLM may request. */
export type McpToolName = "retrieve_file" | "smart_search" | "graph_search" | "keyword_lookup";

/** One row of the per-record tool-call log. */
export interface McpToolCallLog {
  tool: McpToolName;
  /** The query / path / channel argument the LLM (or our planner) passed. */
  argument: string;
  /** Did the HTTP request succeed (200) and the body parse as expected JSON? */
  ok: boolean;
  /** Error message when `ok === false`; null on success. */
  error: string | null;
}

/** Per-changed-field provenance entry. */
export interface FieldProvenance {
  /** Dotted path of the field (`importsInternal[0].resolvedFileId`, `ambiguities[2].resolution`, ...). */
  field: string;
  /**
   * `file-analysis` when the value is preserved verbatim from the file's semantic analysis;
   * `enrichment` when this mcp-enrichment run wrote or changed it.
   */
  origin: "file-analysis" | "enrichment";
  /** One-line reason from the LLM (or null when origin === "file-analysis"). */
  reason: string | null;
}

/** The `_provenance` block carried by every enrichment record. */
export interface EnrichmentProvenance {
  fields: FieldProvenance[];
  mcpToolCalls: McpToolCallLog[];
  /** One-line notes from the enrichment run for fields it could not resolve or surprising findings. */
  enrichmentNotes: string[];
  budgetExhausted: boolean;
}

/**
 * The persisted enrichment record. `enrichment` is a partial {@link SemanticFields} carrying
 * ONLY the fields this mcp-enrichment run touched (or fields the LLM re-affirmed). Consumers
 * fetch the file-analysis record side-by-side via the same encoded path; the two are merged
 * at read time.
 */
export interface McpEnrichmentRecord {
  relativePath: string;
  /** Set for big-file chunks; absent for small files. */
  chunkNumber?: number;
  enrichedAt: string;
  enrichment: Partial<SemanticFields>;
  _provenance: EnrichmentProvenance;
  tokenUsage: TokenUsage;
  /** The MCP URL the run was dispatched against (audit trail). */
  mcpUrl: string;
  /** Total MCP tool calls issued for this record (matches `_provenance.mcpToolCalls.length`). */
  mcpToolCalls: number;
}
