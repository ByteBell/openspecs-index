/**
 * Narrows the mcp-enrichment LLM response envelope into a typed shape the agent loop consumes.
 * Untrusted JSON enters here and exits as {@link EnrichResponse}.
 *
 * The response carries:
 * - `toolRequests`: what the model wants the toolset to fetch next.
 * - `enrichmentJson`: the model's partial enrichment payload (kept as a `Record<string, unknown>`
 *   so the loop can merge sub-objects field-by-field without re-narrowing on every round).
 * - `fieldChanges`: per-changed-field reasons (dotted-path + one-line reason).
 * - `enrichmentNotes`: one-line notes for fields the model couldn't resolve.
 * - `done`: true when the model says it's finished refining.
 */
import { pickString, pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import {
  asRecord,
  pickBool,
  pickRecordArray,
} from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";
import type { McpToolName } from "../records.ts";

const TOOL_NAMES: ReadonlySet<McpToolName> = new Set([
  "retrieve_file",
  "smart_search",
  "graph_search",
  "keyword_lookup",
]);

/** One tool request the model wants the loop to execute next round. */
export interface ToolRequest {
  tool: McpToolName;
  argument: string;
  reason: string;
}

/** One per-changed-field provenance entry the model reports. */
export interface FieldChangeReport {
  field: string;
  reason: string;
}

/** Narrowed enrichment response for one round of the agent loop. */
export interface EnrichResponse {
  toolRequests: ToolRequest[];
  /** The `enrichment` sub-object — kept as a raw record so the loop merges field-by-field. */
  enrichmentJson: Record<string, unknown>;
  fieldChanges: FieldChangeReport[];
  enrichmentNotes: string[];
  done: boolean;
}

/** Returns an empty response (used on unparseable LLM output). `done: true` halts the loop. */
export function emptyEnrichResponse(): EnrichResponse {
  return { toolRequests: [], enrichmentJson: {}, fieldChanges: [], enrichmentNotes: [], done: true };
}

function parseToolRequests(value: unknown): ToolRequest[] {
  const out: ToolRequest[] = [];
  for (const rec of pickRecordArray(value)) {
    const toolRaw = pickString(rec["tool"], "");
    const argument = pickString(rec["argument"], "");
    if (toolRaw.length === 0 || argument.length === 0) {
      continue;
    }
    if (!TOOL_NAMES.has(toolRaw as McpToolName)) {
      continue;
    }
    out.push({
      tool: toolRaw as McpToolName,
      argument,
      reason: pickString(rec["reason"], ""),
    });
  }
  return out;
}

function parseFieldChanges(value: unknown): FieldChangeReport[] {
  const out: FieldChangeReport[] = [];
  for (const rec of pickRecordArray(value)) {
    const field = pickString(rec["field"], "");
    if (field.length === 0) {
      continue;
    }
    out.push({ field, reason: pickString(rec["reason"], "") });
  }
  return out;
}

/**
 * Narrows an untrusted enrichment response envelope.
 *
 * @param raw - The model's untrusted JSON.
 * @returns A total {@link EnrichResponse}; missing or malformed fields default to safe values.
 */
export function parseEnrichResponse(raw: unknown): EnrichResponse {
  const top = asRecord(raw);
  if (top === null) {
    return emptyEnrichResponse();
  }
  return {
    toolRequests: parseToolRequests(top["tool_requests"]),
    enrichmentJson: asRecord(top["enrichment"]) ?? {},
    fieldChanges: parseFieldChanges(top["field_changes"]),
    enrichmentNotes: pickStringArray(top["enrichment_notes"]),
    done: pickBool(top["done"]),
  };
}
