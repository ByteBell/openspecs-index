/**
 * HTTP binding for {@link McpToolset}. Posts JSON-RPC 2.0 envelopes to the configured MCP URL —
 * one POST per tool call. Transport failures (network, non-2xx, malformed JSON, JSON-RPC error
 * field present) surface as `McpToolResult` values with `ok: false`, never as thrown errors,
 * so the LLM agent can read them in the next round.
 *
 * Configuration errors (URL missing, initial reachability probe non-200) are raised by the
 * caller — see `probeMcp` below. Transport errors mid-run are tolerated.
 */
import { logger } from "@bb/logger";
import type { McpToolResult, McpToolset } from "./toolset.ts";

const JSON_RPC_VERSION = "2.0";

/** Configuration for the HTTP MCP toolset. */
export interface HttpMcpToolsetConfig {
  /** Required. The MCP server URL the strategy targets. */
  url: string;
  /** Optional. Sent as the `Authorization` header on every request when set. */
  authHeader?: string;
}

/** JSON-RPC request envelope. */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: { name: string; arguments: Record<string, unknown> };
}

/** JSON-RPC response envelope (success and error cases). */
interface JsonRpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** Issues one tool/call POST, returning an {@link McpToolResult} that never throws. */
async function callTool(
  config: HttpMcpToolsetConfig,
  toolName: string,
  args: Record<string, unknown>,
  callId: number,
): Promise<McpToolResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.authHeader !== undefined && config.authHeader.length > 0) {
    headers["authorization"] = config.authHeader;
  }
  const body: JsonRpcRequest = {
    jsonrpc: JSON_RPC_VERSION,
    id: callId,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };

  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, result: null, error: `transport: ${msg}`, budgetExhausted: false };
  }

  if (!response.ok) {
    return {
      ok: false,
      result: null,
      error: `http ${response.status} ${response.statusText}`,
      budgetExhausted: false,
    };
  }

  let parsed: JsonRpcResponse;
  try {
    parsed = (await response.json()) as JsonRpcResponse;
  } catch (cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, result: null, error: `parse: ${msg}`, budgetExhausted: false };
  }

  if (parsed.error !== undefined && parsed.error !== null) {
    const code = parsed.error.code ?? "?";
    const msg = parsed.error.message ?? "unknown";
    return { ok: false, result: null, error: `rpc ${code}: ${msg}`, budgetExhausted: false };
  }

  return { ok: true, result: parsed.result ?? null, error: null, budgetExhausted: false };
}

/**
 * Creates the HTTP-backed {@link McpToolset}. Each method maps to a JSON-RPC `tools/call` POST
 * to the configured URL. Call IDs are monotonic per toolset instance so a server can correlate
 * concurrent calls — but each `call` blocks until its response arrives.
 *
 * @param config - URL + optional auth header.
 * @returns A toolset that never throws on transport errors.
 */
export function createHttpMcpToolset(config: HttpMcpToolsetConfig): McpToolset {
  let nextId = 1;
  return {
    retrieveFile: (filePath) => callTool(config, "retrieve_file", { path: filePath }, nextId++),
    smartSearch: (query) => callTool(config, "smart_search", { query }, nextId++),
    graphSearch: (query) => callTool(config, "graph_search", { query }, nextId++),
    keywordLookup: (keyword) => callTool(config, "keyword_lookup", { keyword }, nextId++),
  };
}

/**
 * Reachability probe — issues one trivial JSON-RPC call (`tools/list` is conventional in MCP)
 * and throws when the configured URL is not reachable or returns a non-2xx response. Called by
 * the strategy at startup; a failure here fails the whole job.
 *
 * @param config - URL + optional auth header.
 * @throws {Error} with a contextual message when the URL is unset, the request fails, or the
 *                 server returns a non-2xx status.
 */
export async function probeMcp(config: HttpMcpToolsetConfig): Promise<void> {
  if (config.url.length === 0) {
    throw new Error("McpEnrichmentUrl is not configured");
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.authHeader !== undefined && config.authHeader.length > 0) {
    headers["authorization"] = config.authHeader;
  }
  const body = JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id: 0, method: "tools/list" });
  let response: Response;
  try {
    response = await fetch(config.url, { method: "POST", headers, body });
  } catch (cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`MCP probe failed (transport): ${msg}`);
  }
  if (!response.ok) {
    throw new Error(`MCP probe failed: http ${response.status} ${response.statusText}`);
  }
  logger.debug(`mcp-enrichment: probe OK against ${config.url}`);
}
