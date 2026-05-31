/**
 * Per-record agent loop. For one file-analysis record (small file OR one big-file chunk):
 *
 * 1. Read the file-analysis record + (for chunks) sibling chunks + (verbatim) source.
 * 2. Run an agent loop of up to {@link MAX_ROUNDS} rounds:
 *    - Ask the LLM for the next envelope (tool requests + partial enrichment + done flag).
 *    - Execute the requested tool calls through the budget-capped toolset (20 total).
 *    - Merge the partial enrichment into the accumulator.
 *    - Stop when the LLM sets `done: true` OR the tool budget is exhausted OR rounds run out.
 * 3. Build and return an {@link McpEnrichmentRecord} — the strategy writes it to disk.
 *
 * Failure modes (see CLAUDE.md / context.md):
 * - Missing file-analysis record → caller skips with a warning; never reached here.
 * - Unparseable LLM JSON → empty enrichment is written with `enrichmentNotes` explaining.
 * - Budget exhausted → record written with whatever was gathered, `budgetExhausted: true`.
 * - LLM transport / config error → bubbles up (strategy fails the job per IR convention).
 */
import { askJsonLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { addUsage, ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import { usageOf } from "#src/strategies/intermediate-representation/usage.ts";
import type { McpEnrichmentRecord, EnrichmentProvenance } from "../records.ts";
import type { McpToolset, McpCallLogBuffer } from "../mcp/toolset.ts";
import type { McpToolResult } from "../mcp/toolset.ts";
import { DEFAULT_MCP_BUDGET } from "../mcp/toolset.ts";
import {
  ENRICH_SYSTEM_PROMPT,
  buildEnrichUserPrompt,
} from "../prompts/enrich.ts";
import {
  emptyEnrichResponse,
  parseEnrichResponse,
  type EnrichResponse,
  type ToolRequest,
} from "../parse/enrich.ts";

/** Hard cap on agent rounds — bounds LLM cost per record. */
export const MAX_ROUNDS = 4;

/** Input to {@link runEnrichForRecord}. */
export interface EnrichForRecordInput {
  relativePath: string;
  chunkNumber?: number;
  /** The file-analysis record JSON (the `analysis` payload), stringified for the prompt. */
  semanticAnalysisJson: string;
  /** Sibling chunks' semantic analyses (big files only), stringified for the prompt. */
  siblingChunksJson: string;
  /** Verbatim source of the file or chunk under review. */
  sourceContent: string;
  /** Budget-wrapped MCP toolset. */
  toolset: McpToolset;
  /** Buffer the toolset writes every call into (read at the end to assemble provenance). */
  callLog: McpCallLogBuffer;
  /** MCP URL — recorded into the enrichment record's audit trail. */
  mcpUrl: string;
  /** Optional LLM context (per-org credentials, etc.). */
  llmCallContext?: AskLlmOptions;
}

/** Internal accumulator across rounds. */
interface AgentState {
  /** Round counter (1-based). */
  round: number;
  /** Accumulated enrichment payload (merged field-by-field across rounds). */
  enrichment: Record<string, unknown>;
  /** Accumulated per-changed-field reasons. */
  fieldReasons: Map<string, string>;
  /** Accumulated enrichment notes. */
  notes: string[];
  /** Tool-call results gathered so far (oldest first). */
  toolResults: ToolResultEntry[];
  /** Summed token usage. */
  tokenUsage: TokenUsage;
}

/** One tool-call result snapshot we feed back to the LLM in the next round. */
interface ToolResultEntry {
  tool: string;
  argument: string;
  ok: boolean;
  result: unknown;
  error: string | null;
}

/** Dispatches one tool request through the budget-capped toolset. */
async function dispatchToolRequest(toolset: McpToolset, req: ToolRequest): Promise<McpToolResult> {
  switch (req.tool) {
    case "retrieve_file":
      return toolset.retrieveFile(req.argument);
    case "smart_search":
      return toolset.smartSearch(req.argument);
    case "graph_search":
      return toolset.graphSearch(req.argument);
    case "keyword_lookup":
      return toolset.keywordLookup(req.argument);
  }
}

/**
 * Merges one round's partial enrichment into the accumulator. Last writer wins per top-level
 * key — the model is told to emit complete sub-objects when it refines a field.
 */
function mergeEnrichment(acc: Record<string, unknown>, next: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(next)) {
    acc[key] = value;
  }
}

/** Runs one round: askJsonLLM, parse, execute tool requests, merge accumulator. */
async function runOneRound(
  state: AgentState,
  input: EnrichForRecordInput,
): Promise<{ done: boolean; budgetExhausted: boolean }> {
  const userPrompt = buildEnrichUserPrompt({
    relativePath: input.relativePath,
    ...(input.chunkNumber !== undefined ? { chunkNumber: input.chunkNumber } : {}),
    semanticAnalysisJson: input.semanticAnalysisJson,
    siblingChunksJson: input.siblingChunksJson,
    sourceContent: input.sourceContent,
    roundNumber: state.round,
    toolResultsJson: JSON.stringify(state.toolResults, null, 2),
    remainingBudget: DEFAULT_MCP_BUDGET - input.callLog.entries.length,
  });

  let parsedResponse: EnrichResponse;
  try {
    const llmResponse = await askJsonLLM<Record<string, unknown>>(
      ENRICH_SYSTEM_PROMPT,
      userPrompt,
      input.llmCallContext ?? {},
    );
    state.tokenUsage = addUsage(state.tokenUsage, usageOf(llmResponse.usage));
    if (llmResponse.result === null) {
      logger.warn(`mcp-enrichment: ${input.relativePath} round ${state.round} returned unparseable JSON`);
      state.notes.push(`round ${state.round}: LLM returned unparseable JSON`);
      return { done: true, budgetExhausted: input.callLog.budgetExhausted };
    }
    parsedResponse = parseEnrichResponse(llmResponse.result);
  } catch (cause: unknown) {
    if (cause instanceof LlmConfigError || cause instanceof LlmError) {
      throw cause;
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`mcp-enrichment: ${input.relativePath} round ${state.round} askJsonLLM failed: ${msg}`);
    state.notes.push(`round ${state.round}: askJsonLLM failed: ${msg}`);
    return { done: true, budgetExhausted: input.callLog.budgetExhausted };
  }

  mergeEnrichment(state.enrichment, parsedResponse.enrichmentJson);
  for (const change of parsedResponse.fieldChanges) {
    state.fieldReasons.set(change.field, change.reason);
  }
  for (const note of parsedResponse.enrichmentNotes) {
    state.notes.push(note);
  }

  for (const req of parsedResponse.toolRequests) {
    if (input.callLog.budgetExhausted) {
      break;
    }
    const result = await dispatchToolRequest(input.toolset, req);
    state.toolResults.push({
      tool: req.tool,
      argument: req.argument,
      ok: result.ok,
      result: result.result,
      error: result.error,
    });
  }

  return { done: parsedResponse.done, budgetExhausted: input.callLog.budgetExhausted };
}

/**
 * Runs the agent loop for one file-analysis record and assembles its enrichment record.
 *
 * @param input - Everything one record needs: paths, semantic analysis, source, toolset, log.
 * @returns The persist-ready {@link McpEnrichmentRecord}.
 */
export async function runEnrichForRecord(input: EnrichForRecordInput): Promise<McpEnrichmentRecord> {
  const state: AgentState = {
    round: 1,
    enrichment: {},
    fieldReasons: new Map(),
    notes: [],
    toolResults: [],
    tokenUsage: ZERO_USAGE,
  };

  let budgetExhausted = false;
  for (state.round = 1; state.round <= MAX_ROUNDS; state.round += 1) {
    const outcome = await runOneRound(state, input);
    budgetExhausted = outcome.budgetExhausted;
    if (outcome.done || budgetExhausted) {
      break;
    }
  }

  const provenance: EnrichmentProvenance = {
    fields: Array.from(state.fieldReasons.entries()).map(([field, reason]) => ({
      field,
      origin: "enrichment",
      reason,
    })),
    mcpToolCalls: input.callLog.entries,
    enrichmentNotes: state.notes,
    budgetExhausted,
  };

  const record: McpEnrichmentRecord = {
    relativePath: input.relativePath,
    ...(input.chunkNumber !== undefined ? { chunkNumber: input.chunkNumber } : {}),
    enrichedAt: new Date().toISOString(),
    enrichment: state.enrichment,
    _provenance: provenance,
    tokenUsage: state.tokenUsage,
    mcpUrl: input.mcpUrl,
    mcpToolCalls: input.callLog.entries.length,
  };
  return record;
}

/** Returns the empty enrichment response so external tests can assert the failure shape. */
export const __INTERNAL_emptyEnrichResponse = emptyEnrichResponse;
