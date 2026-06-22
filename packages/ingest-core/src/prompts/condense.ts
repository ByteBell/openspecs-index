import { FILE_ANALYSIS_FIELDS_BLOCK } from "./file-analysis-fields.ts";

const CONDENSE_MERGE_RULES = `## Merge rules (apply on top of the field definitions above)

- purpose          : merge into ONE cohesive 2-3 sentence description.
- summary          : ≤600 tokens, plain-English; cover what the file does, why it exists, and how it fits in the system.
- businessContext  : merge into ONE short paragraph (2-3 lines).
- language         : single canonical name; if items disagree, pick the value that appears most often; "unknown" if truly inconclusive.
- classes          : deduplicate. Keep ONLY exported / public / entry-point items. Drop private helpers and internal DTOs. Aggressively filter to stay under ~3000 tokens total. Preserve the "Name (~Lstart-end): description" format. Each entry MUST be a single class — never concatenate multiple into one string.
- functions        : deduplicate. Keep ONLY exported / public / entry-point items, API handlers, lifecycle methods. Drop private helpers and trivial getters/setters. Aggressively filter to stay under ~3000 tokens total. Preserve the "name (~Lstart-end): description" format. Each entry MUST be a single function — never concatenate multiple into one string.
- importsInternal  : deduplicate within the list. Keep significant relative imports.
- importsExternal  : deduplicate within the list. Drop stdlib and trivial utilities; keep significant frameworks and core packages.
- keywords         : deduplicate, keep the top 10 most representative.
- ontologyConcepts / businessEntities / systemCapabilities / sideEffects / configDependencies / integrationSurface / contractsProvided / contractsConsumed : deduplicate. Prefer specific terms over generic ones. Cap each at 8 entries.
- dataFlowDirection: pick the most representative single value; "internal" if mixed and no boundary dominates.
- sectionMap       : merge per-section descriptions, preserve order by start line.`;

export const CONDENSE_SYSTEM_PROMPT = `You are condensing N partial analyses of a single source file into ONE coherent file-level analysis for a code knowledge graph.

Rules:
- Return ONLY a JSON object. No prose, no markdown fences, no commentary.
- Use EXACTLY the same keys as each input partial.

## Field definitions

${FILE_ANALYSIS_FIELDS_BLOCK}

${CONDENSE_MERGE_RULES}`;

export function buildCondenseUserPrompt(input: { relativePath: string; serialized: string; count: number }): string {
  return `Condense the following ${input.count} partial analyses of \`${input.relativePath}\` into ONE final analysis:

${input.serialized}`;
}
