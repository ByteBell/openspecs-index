import { _runCypher } from "./client.ts";

const CONSTRAINTS = [
  "CREATE CONSTRAINT knowledge_id IF NOT EXISTS FOR (k:Knowledge) REQUIRE k.knowledgeId IS UNIQUE",
  "CREATE CONSTRAINT file_unique IF NOT EXISTS FOR (f:File) REQUIRE (f.knowledgeId, f.relativePath) IS UNIQUE",
  "CREATE CONSTRAINT file_version_unique IF NOT EXISTS FOR (fv:FileVersion) REQUIRE (fv.knowledgeId, fv.relativePath, fv.commitHash) IS UNIQUE",
  "CREATE CONSTRAINT keyword_name IF NOT EXISTS FOR (kw:Keyword) REQUIRE kw.name IS UNIQUE",
  "CREATE CONSTRAINT class_signature IF NOT EXISTS FOR (c:Class) REQUIRE c.signature IS UNIQUE",
  "CREATE CONSTRAINT function_signature IF NOT EXISTS FOR (fn:Function) REQUIRE fn.signature IS UNIQUE",
  "CREATE CONSTRAINT module_name IF NOT EXISTS FOR (m:Module) REQUIRE m.name IS UNIQUE",
];

const FULLTEXT_INDEXES = [
  "CREATE FULLTEXT INDEX idx_file_purpose_summary_ft IF NOT EXISTS FOR (f:File) ON EACH [f.purpose, f.summary]",
  "CREATE FULLTEXT INDEX idx_file_business_context_ft IF NOT EXISTS FOR (f:File) ON EACH [f.businessContext]",
  "CREATE FULLTEXT INDEX idx_keyword_name_ft IF NOT EXISTS FOR (kw:Keyword) ON EACH [kw.name]",
  "CREATE FULLTEXT INDEX idx_symbol_signature_ft IF NOT EXISTS FOR (n:Class|Function) ON EACH [n.signature]",
];

export async function ensureKnowledgeIndexes(): Promise<void> {
  const results = await Promise.allSettled(
    [...CONSTRAINTS, ...FULLTEXT_INDEXES].map((cypher) =>
      _runCypher(cypher).catch((cause: unknown) => {
        const msg = cause instanceof Error ? cause.message : String(cause);
        if (msg.includes("already exists") || msg.includes("EquivalentSchemaRuleAlreadyExists")) {
          process.stderr.write(`[neo4j] schema already present, skipping: ${cypher.slice(0, 60)}…\n`);
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
