/**
 * The mcp-enrichment system prompt and user-message builder. The strategy runs an agent loop
 * over a bounded number of rounds: each round the model returns the {@link ENRICH_JSON_SHAPE}
 * envelope, the loop executes the requested tool calls (budget-capped), and feeds results
 * back as part of the next round's user message.
 *
 * Hard contracts the model is told to honour:
 * - It may refine any semantic field EXCEPT `verbatim_literals` and `boundary_conditions`,
 *   which are preserved byte-for-byte from the file's semantic analysis.
 * - Cross-file resolution (`resolved_relative_path`, `resolved_file_id`) is the primary job —
 *   set them when graph_search / retrieve_file confirm a target file exists in this knowledge.
 * - Unresolved ambiguities stay `null`; the model adds a one-line `enrichment_note` instead
 *   of guessing.
 */
import { ENRICH_JSON_SHAPE } from "./enrich-fields.ts";

export const ENRICH_SYSTEM_PROMPT = `You are a cross-file code-knowledge enricher. Your input is the semantic analysis of a single source file (or a single chunk of a big file). Your job is to use cross-file lookups to fill in fields that could not be resolved from the file alone.

Your tools (MCP — exposed only via the JSON \`tool_requests\` field):
- retrieve_file(path)   — fetch the verbatim source of another file in this knowledge.
- smart_search(query)   — semantic search across the knowledge's file-analysis records.
- graph_search(query)   — graph traversal (call edges, import edges, contract edges).
- keyword_lookup(keyword) — fast exact-token search.

You operate as an agent loop:
1. Read the file's semantic analysis and the current source of the file under review.
2. Decide which (if any) tool calls would close gaps (resolve imports, find a contract's
   defining file, clear an ambiguity, confirm a cross-file callgraph edge).
3. Emit a JSON envelope with the tool_requests, your current best enrichment, and done=false.
4. The loop executes your requests (capped at 20 total calls across all rounds for this record),
   feeds the results back, and asks you for another envelope.
5. When you have nothing more to fetch or refine, return done=true.

Rules:
- Return ONLY a JSON object. No prose, no markdown fences.
- NEVER modify \`verbatim_literals\` or \`boundary_conditions\`. They are append-only here.
- Cross-file fields you should fill: imports.resolved_relative_path / resolved_file_id,
  contracts_provided.* / contracts_consumed.* resolution, ambiguities.resolution.
- When echoing entries back inside \`enrichment\`, use the EXACT strings from the file's
  semantic analysis for the matching keys (\`spec\` for imports, \`name\` for contracts,
  \`question\` + \`affects\` for ambiguities) — the loop matches your entries by those keys.
- For \`field_changes\`, list every changed dotted path with a one-line reason. Carryovers
  do NOT appear here.
- If the budget is exhausted, set done=true and explain in enrichment_notes which fields you
  would have refined next.

JSON shape:

${ENRICH_JSON_SHAPE}`;

/** Input to {@link buildEnrichUserPrompt} — round-specific context the loop assembles. */
export interface EnrichUserPromptInput {
  relativePath: string;
  chunkNumber?: number;
  /** The file's semantic-analysis JSON (the full `FileAnalysisResult.analysis` payload). */
  semanticAnalysisJson: string;
  /** For big files: semantic analysis for every OTHER chunk of the same file, JSON-stringified. */
  siblingChunksJson: string;
  /** The original file or chunk source (verbatim, never re-analysed). */
  sourceContent: string;
  /** Round number (1-based). */
  roundNumber: number;
  /** Tool-call results gathered so far across all rounds (oldest first). */
  toolResultsJson: string;
  /** Remaining budget (20 - calls used). The model uses this to decide if it should batch more. */
  remainingBudget: number;
}

/**
 * Builds the user-message string for one round of the agent loop.
 *
 * @param input - The semantic-analysis JSON, sibling chunks, source content, round number,
 *                prior tool results, and remaining budget.
 * @returns The full user message for `askJsonLLM`.
 */
export function buildEnrichUserPrompt(input: EnrichUserPromptInput): string {
  const chunkLine = input.chunkNumber === undefined ? "" : `\nCHUNK_NUMBER: ${input.chunkNumber}`;
  return `RELATIVE_PATH: ${input.relativePath}${chunkLine}
ROUND: ${input.roundNumber}
REMAINING_TOOL_BUDGET: ${input.remainingBudget}

=== FILE'S SEMANTIC ANALYSIS (immutable input) ===
${input.semanticAnalysisJson}

=== SIBLING CHUNKS' SEMANTIC ANALYSIS ===
${input.siblingChunksJson}

=== VERBATIM SOURCE OF THIS FILE/CHUNK ===
${input.sourceContent}

=== TOOL CALL RESULTS SO FAR (oldest first) ===
${input.toolResultsJson}

Emit the JSON envelope now.`;
}
