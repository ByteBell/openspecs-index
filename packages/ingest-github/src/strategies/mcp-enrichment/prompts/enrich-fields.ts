/**
 * The JSON shape the mcp-enrichment LLM must emit on every round. The agent loop hands the
 * model the file's semantic analysis + any prior tool results, and the model returns this envelope:
 * - `tool_requests`: what the model wants the toolset to fetch next (executed by the loop).
 * - `enrichment`:    the partial semantic-fields payload the model has refined so far.
 * - `enrichment_notes`: one-line notes for fields the model could not resolve.
 * - `done`:          true when the model has finished refining and no more rounds are needed.
 *
 * Verbatim literals and boundary conditions from the file's semantic analysis MUST NOT be
 * mutated by mcp-enrichment. The model is instructed accordingly in the system prompt; the
 * parser does not enforce this at narrowing time.
 */
export const ENRICH_JSON_SHAPE = `Return JSON with EXACTLY these top-level keys:
{
  "tool_requests": [
    {
      "tool": "retrieve_file | smart_search | graph_search | keyword_lookup",
      "argument": "string — the path for retrieve_file, the query for the others",
      "reason": "one line: why you want this lookup"
    }
  ],
  "enrichment": {
    "_comment": "Partial SemanticFields — include ONLY fields you are confidently refining or affirming this round.",
    "ambiguities": [
      {
        "question": "string (verbatim from the file's semantic analysis)",
        "affects": "string (verbatim from the file's semantic analysis)",
        "anchor": { "start_line": 0, "end_line": 0 },
        "resolution": "one-line answer informed by tool results, or null when still unresolved"
      }
    ],
    "imports_internal": [
      {
        "spec": "verbatim from the file's semantic analysis",
        "symbols": ["verbatim from the file's semantic analysis"],
        "anchor": { "start_line": 0, "end_line": 0 },
        "resolved_relative_path": "string or null",
        "resolved_file_id": "string or null"
      }
    ],
    "contracts_provided": [
      { "name": "string", "shape": "string", "resolved_relative_path": "string or null", "resolved_file_id": "string or null" }
    ],
    "contracts_consumed": [
      { "name": "string", "shape": "string", "resolved_relative_path": "string or null", "resolved_file_id": "string or null" }
    ]
  },
  "field_changes": [
    {
      "field": "dotted path: importsInternal[0].resolvedFileId, ambiguities[2].resolution, ...",
      "reason": "one-line reason for this specific change"
    }
  ],
  "enrichment_notes": ["one-line note per unresolved field or surprising finding"],
  "done": false
}`;
