import { PER_FILE_ENRICHMENT_JSON_SCHEMA_HINT } from "#src/concept-graph/enrichment-schema.ts";
import type { CondensedFileAnalysis } from "@bb/ingest-core";

// ─────────────────────────────────────────────────────────────────────────────
// Prompts for the ConceptGraphStrategy per-file enrichment LLM call. The
// system prompt is the contract: it pins the schema, the slug conventions,
// and the edge-kind dispatch rules. The user prompt is the file-specific
// payload — the file's existing analysis plus the running list of concepts
// already created in this knowledge so the LLM can converge on canonical
// slugs without consulting MCP for trivial dedup.
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are enriching a knowledge graph that catalogues a software repository. For one source file at a time, you produce structured metadata that contributes to a hypergraph of concepts, contracts, and narrative guideposts spanning the whole codebase.

YOUR OUTPUT
Return exactly one JSON object matching this schema:

${PER_FILE_ENRICHMENT_JSON_SCHEMA_HINT}

Emit ONLY this JSON. Do not wrap it in markdown fences. Do not add commentary before or after. Empty arrays are valid — emit no concepts / contracts / guideposts rather than padding with low-confidence guesses.

SLUGS
Slugs are the canonical identity of concepts, contracts, and guideposts. They MUST be:
- kebab-case (lower-case alphanumeric + hyphens, no spaces, no underscores)
- 1–64 characters
- semantically meaningful (\`auth-controller\` not \`concept-1\`)
- stable: two files that play the same role MUST emit the same slug. When you see an existing slug in the running list below, REUSE IT. Do not invent a near-duplicate (\`auth-handler\` vs \`auth-handlers\`).

EDGE DISPATCH
Each concept attachment picks an edge:
- \`HAS_CONCEPT\` — for \`kind\` of \`ontology\`, \`business\`, or \`capability\`. Use these for cross-file canonicalisation of the per-file analysis arrays (the \`ontologyConcepts\`, \`businessEntities\`, \`systemCapabilities\` strings).
- \`PLAYS_ROLE\` — for \`kind\` of \`role\` or \`pattern\`. Use for "this file IS a Controller / Repository / Adapter / Factory / Strategy / Phase / Migration / Validator …". Roles are the primary axis for navigation (the "all controllers" use case).
- \`BELONGS_TO_DOMAIN\` — for \`kind\` of \`domain\` only. Use for semantic groupings that cross folder boundaries (\`auth\`, \`billing\`, \`ingestion\`, \`indexing\`).

CONTRACTS
A contract is a cross-file boundary: an interface, a Zod schema, an event shape, or a config key, that multiple files reference. Emit \`DEFINES\` when the current file is the source of the contract; \`CONSUMES\` when it imports / uses one.

GUIDEPOSTS
Guideposts are short narrative observations YOU author — not facts present in the file's existing analysis. Kinds:
- \`anomaly\`: "this is the only repository in the codebase that doesn't extend BaseRepository"
- \`convention\`: "all auth files import from @bb/auth/types"
- \`history\`: "this file was renamed from \`X\` in commit abc123; old name still in some imports" — emit only if you have evidence
- \`warning\`: "this file has a tier violation — utils imports from admin-server"
- \`starting-point\`: "to understand the ingestion pipeline, read this file first"

Emit guideposts sparingly. Most files do not deserve one. Prefer 0 guideposts to filler.

TEST TARGET
If this file is a test file (path matches \`*test*\` or \`*spec*\`, or its content imports the file it tests), set \`testTarget.targetRelativePath\` to the relative path of the file under test. Use \`retrieve_file_metadata\` to verify the target file exists in this knowledge before emitting. Skip the field entirely if you cannot confirm a specific target.

TOOLS — MANDATORY USAGE
You have access to MCP tools that query the live knowledge graph: \`smart_search\`, \`keyword_lookup\`, \`retrieve_file_metadata\`, \`retrieve_file_content\`. By default these scope to the current knowledge — pass \`knowledgeIds\` explicitly to search across repos.

**You MUST call at least one MCP tool before emitting your final JSON.** The whole purpose of this enrichment pass is cross-file canonicalisation; emitting concepts without checking the rest of the graph defeats that. Pick the most useful call for this specific file:

- For files that delegate to other modules: call \`keyword_lookup\` on the imported function/class names to confirm where they're defined and what roles they play.
- For files that look like one of an N-of-kind pattern (controllers, repositories, services): call \`smart_search\` with a representative keyword to confirm the pattern and pick the canonical role slug.
- For test files: call \`retrieve_file_metadata\` on the candidate target path before emitting \`testTarget\`.
- For ambiguous files: call \`smart_search\` with the file's purpose summary to surface neighbouring files.

If you genuinely find nothing useful, call \`smart_search\` with one keyword from the file's analysis and proceed with an empty result — that still satisfies the requirement and lets us audit that you tried. Do NOT use tools to look up existing concepts in THIS knowledge for dedup — the running list is already in the user prompt below.

DISCIPLINE
- Anchor every assertion in the file's actual content. Do not invent concepts that "might apply".
- Keep \`rationale\` short and specific (under 500 chars).
- Do not emit concepts whose slugs would collide with file paths or other arbitrary identifiers.
- If the file has no obvious role / domain / contracts, emit empty arrays. That is correct behaviour for utility files.`;

export interface EnrichFilePromptInput {
  relativePath: string;
  analysis: CondensedFileAnalysis;
  /** Compact running list of (slug, kind, name) for concepts already created in this knowledge. */
  knownConcepts: Array<{ slug: string; kind: string; name: string }>;
  /** Compact running list of (slug, kind, name) for contracts already created. */
  knownContracts: Array<{ slug: string; kind: string; name: string }>;
}

export function buildEnrichFileSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildEnrichFileUserPrompt(input: EnrichFilePromptInput): string {
  const a = input.analysis.analysis;
  const lines: string[] = [];
  lines.push(`FILE: ${input.relativePath}`);
  lines.push(`LANGUAGE: ${input.analysis.language}`);
  lines.push("");
  lines.push("EXISTING PER-FILE ANALYSIS");
  lines.push(`purpose: ${truncate(a.purpose, 600)}`);
  lines.push(`summary: ${truncate(a.summary, 1200)}`);
  if (a.businessContext.length > 0) {
    lines.push(`businessContext: ${truncate(a.businessContext, 600)}`);
  }
  if (a.classes.length > 0) {
    lines.push(`classes: ${a.classes.slice(0, 20).join(", ")}`);
  }
  if (a.functions.length > 0) {
    lines.push(`functions: ${a.functions.slice(0, 20).join(", ")}`);
  }
  if (a.keywords.length > 0) {
    lines.push(`keywords: ${a.keywords.slice(0, 30).join(", ")}`);
  }
  if ((a.ontologyConcepts ?? []).length > 0) {
    lines.push(`ontologyConcepts: ${(a.ontologyConcepts ?? []).slice(0, 15).join(", ")}`);
  }
  if ((a.businessEntities ?? []).length > 0) {
    lines.push(`businessEntities: ${(a.businessEntities ?? []).slice(0, 15).join(", ")}`);
  }
  if ((a.systemCapabilities ?? []).length > 0) {
    lines.push(`systemCapabilities: ${(a.systemCapabilities ?? []).slice(0, 15).join(", ")}`);
  }
  if ((a.contractsProvided ?? []).length > 0) {
    lines.push(`contractsProvided: ${(a.contractsProvided ?? []).slice(0, 15).join(", ")}`);
  }
  if ((a.contractsConsumed ?? []).length > 0) {
    lines.push(`contractsConsumed: ${(a.contractsConsumed ?? []).slice(0, 15).join(", ")}`);
  }
  lines.push("");
  lines.push("CONCEPTS ALREADY CREATED IN THIS KNOWLEDGE");
  lines.push(input.knownConcepts.length > 0 ? formatKnownList(input.knownConcepts) : "(none yet)");
  lines.push("");
  lines.push("CONTRACTS ALREADY CREATED IN THIS KNOWLEDGE");
  lines.push(input.knownContracts.length > 0 ? formatKnownList(input.knownContracts) : "(none yet)");
  lines.push("");
  lines.push("Produce the JSON now.");
  return lines.join("\n");
}

function formatKnownList(items: Array<{ slug: string; kind: string; name: string }>): string {
  return items
    .slice(0, 100)
    .map((i) => `- ${i.slug} (${i.kind}): ${i.name}`)
    .join("\n");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
}
