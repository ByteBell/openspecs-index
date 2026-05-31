/**
 * The {@link McpToolset} interface and the 20-call budget wrapper. Every analyzer talks to the
 * MCP backend through this interface, never directly to HTTP. The wrapper enforces the per-record
 * hard cap (20 tool calls) and records every call into a log the per-record loop reads when it
 * builds the enrichment record's `_provenance.mcpToolCalls`.
 *
 * Surfacing tool-call errors as values (not exceptions) is intentional — the LLM should be able
 * to read "this lookup failed" in the next round's context and decide what to do, instead of
 * the whole enrichment for that file blowing up.
 */
import type { McpToolCallLog, McpToolName } from "../records.ts";

/** Default per-record hard cap on tool calls. The plan mandates 20. */
export const DEFAULT_MCP_BUDGET = 10;

/** One tool result the toolset returns. Always carries a status flag so the caller can react. */
export interface McpToolResult {
  ok: boolean;
  /** When `ok === true`: the tool's response body (JSON-parseable structure). Else: null. */
  result: unknown | null;
  /** When `ok === false`: the reason (transport, schema, or budget). Else: null. */
  error: string | null;
  /** True only when the failure is the 20-call cap. */
  budgetExhausted: boolean;
}

/** The shape the MCP backend's transport exposes — see `http-toolset.ts`. */
export interface McpToolset {
  retrieveFile(filePath: string): Promise<McpToolResult>;
  smartSearch(query: string): Promise<McpToolResult>;
  graphSearch(query: string): Promise<McpToolResult>;
  keywordLookup(keyword: string): Promise<McpToolResult>;
}

/** The buffer the budget wrapper writes every call into. The phase reads it to build provenance. */
export interface McpCallLogBuffer {
  entries: McpToolCallLog[];
  budgetExhausted: boolean;
}

/** Creates a fresh, empty call log buffer. */
export function createMcpCallLogBuffer(): McpCallLogBuffer {
  return { entries: [], budgetExhausted: false };
}

/**
 * Wraps an inner {@link McpToolset} with a hard budget. Once `budget` total calls have been
 * attempted, every subsequent call short-circuits to a `budgetExhausted` result and the buffer's
 * flag is set so the caller knows to stop asking. Counts attempts, not successes — a transport
 * failure still consumes one slot.
 */
export function withBudget(
  inner: McpToolset,
  buffer: McpCallLogBuffer,
  budget: number = DEFAULT_MCP_BUDGET,
): McpToolset {
  let used = 0;

  function logAndReturn(tool: McpToolName, argument: string, result: McpToolResult): McpToolResult {
    const entry: McpToolCallLog = { tool, argument, ok: result.ok, error: result.error };
    buffer.entries.push(entry);
    if (result.budgetExhausted) {
      buffer.budgetExhausted = true;
    }
    return result;
  }

  function budgetExhaustedResult(): McpToolResult {
    return {
      ok: false,
      result: null,
      error: `MCP tool budget exhausted (${budget} calls)`,
      budgetExhausted: true,
    };
  }

  async function callWithBudget(
    tool: McpToolName,
    argument: string,
    fn: () => Promise<McpToolResult>,
  ): Promise<McpToolResult> {
    if (used >= budget) {
      const exhausted = budgetExhaustedResult();
      return logAndReturn(tool, argument, exhausted);
    }
    used += 1;
    const result = await fn();
    return logAndReturn(tool, argument, result);
  }

  return {
    retrieveFile: (filePath) => callWithBudget("retrieve_file", filePath, () => inner.retrieveFile(filePath)),
    smartSearch: (query) => callWithBudget("smart_search", query, () => inner.smartSearch(query)),
    graphSearch: (query) => callWithBudget("graph_search", query, () => inner.graphSearch(query)),
    keywordLookup: (keyword) => callWithBudget("keyword_lookup", keyword, () => inner.keywordLookup(keyword)),
  };
}
