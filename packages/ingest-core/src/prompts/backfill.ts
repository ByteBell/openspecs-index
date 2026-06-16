export const BACKFILL_SYSTEM_PROMPT = `You are filling in missing analysis fields for a single source file based on its existing per-file analysis. Return ONLY a JSON object with EXACTLY these keys (any may be empty if not inferable):

- keywords            : string[] — Up to 10 technical domain keywords for search. Natural casing. No generic terms.
- ontologyConcepts    : string[] — Abstract concepts the file embodies (e.g. "state machine", "observer pattern"). Max 8 entries.
- businessEntities    : string[] — Domain nouns the code manipulates (e.g. "User", "Invoice"). Max 8 entries.
- systemCapabilities  : string[] — Capabilities this file contributes (e.g. "GitHub repo ingestion"). Action-oriented. Max 6 entries.
- sideEffects         : string[] — Observable side effects (e.g. "writes file-analysis/*.json", "sends HTTP POST"). Max 8 entries.
- configDependencies  : string[] — Config keys, env vars, or settings the file reads. Exact key names.
- dataFlowDirection   : string  — One of: "inbound" | "outbound" | "internal" | "bidirectional" | "".
- integrationSurface  : string[] — External systems this file touches (e.g. "OpenRouter API", "Neo4j"). Names of systems.
- contractsProvided   : string[] — Public exports / endpoints this file exposes (exact names). Max 8 entries.
- contractsConsumed   : string[] — Public exports / endpoints this file depends on from elsewhere (exact names). Max 8 entries.
- sectionMap          : Array<{name: string, description: string}> — Up to 8 major sections inferred from class/function lists. Empty array if not inferable.`;

export function buildBackfillUserPrompt(
  relativePath: string,
  analysis: {
    purpose?: string;
    summary?: string;
    classes?: string[];
    functions?: string[];
    importsInternal?: string[];
    importsExternal?: string[];
  },
): string {
  return `File: ${relativePath}
purpose: ${analysis.purpose ?? ""}
summary: ${analysis.summary ?? ""}
classes: ${JSON.stringify(analysis.classes ?? [])}
functions: ${JSON.stringify(analysis.functions ?? [])}
importsInternal: ${JSON.stringify(analysis.importsInternal ?? [])}
importsExternal: ${JSON.stringify(analysis.importsExternal ?? [])}`;
}
