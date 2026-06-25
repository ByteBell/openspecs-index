import { _runCypher } from "./client.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Schema bootstrap for the ConceptGraphStrategy. Idempotent — tolerates
// pre-existing constraints/indexes the same way `ensureKnowledgeIndexes` does.
//
// Uniqueness constraints are canonical-key constraints; without them, parallel
// per-file enrichment could race two `:Concept` nodes with the same slug.
// Fulltext indexes power MCP's `smart_search` over the new node types.
// ─────────────────────────────────────────────────────────────────────────────

const CONSTRAINTS = [
  "CREATE CONSTRAINT concept_unique IF NOT EXISTS FOR (c:Concept) REQUIRE (c.orgId, c.knowledgeId, c.slug) IS UNIQUE",
  "CREATE CONSTRAINT contract_unique IF NOT EXISTS FOR (c:Contract) REQUIRE (c.orgId, c.knowledgeId, c.slug) IS UNIQUE",
  "CREATE CONSTRAINT guidepost_unique IF NOT EXISTS FOR (g:Guidepost) REQUIRE (g.orgId, g.knowledgeId, g.slug) IS UNIQUE",
];

const FULLTEXT_INDEXES = [
  "CREATE FULLTEXT INDEX idx_concept_name_rationale_ft IF NOT EXISTS FOR (c:Concept) ON EACH [c.name, c.rationale]",
  "CREATE FULLTEXT INDEX idx_contract_name_ft IF NOT EXISTS FOR (c:Contract) ON EACH [c.name]",
  "CREATE FULLTEXT INDEX idx_guidepost_note_area_ft IF NOT EXISTS FOR (g:Guidepost) ON EACH [g.note, g.area]",
];

export async function ensureConceptGraphIndexes(): Promise<void> {
  const results = await Promise.allSettled(
    [...CONSTRAINTS, ...FULLTEXT_INDEXES].map((cypher) =>
      _runCypher(cypher).catch((cause: unknown) => {
        const msg = cause instanceof Error ? cause.message : String(cause);
        if (msg.includes("already exists") || msg.includes("EquivalentSchemaRuleAlreadyExists")) {
          process.stderr.write(`[neo4j] concept-graph schema already present, skipping: ${cypher.slice(0, 60)}…\n`);
          return;
        }
        throw cause;
      }),
    ),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      throw result.reason;
    }
  }
}
