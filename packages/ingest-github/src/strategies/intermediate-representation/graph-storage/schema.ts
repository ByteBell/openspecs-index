import { runCypher } from "@bb/neo4j";

const CONSTRAINTS = [
  // Identity nodes
  "CREATE CONSTRAINT ir_knowledge_unique IF NOT EXISTS FOR (k:Knowledge) REQUIRE (k.knowledgeId) IS UNIQUE",
  "CREATE CONSTRAINT ir_file_unique IF NOT EXISTS FOR (f:File) REQUIRE (f.knowledgeId, f.relativePath) IS UNIQUE",
  "CREATE CONSTRAINT ir_chunk_unique IF NOT EXISTS FOR (c:Chunk) REQUIRE (c.knowledgeId, c.relativePath, c.chunkIndex) IS UNIQUE",
  "CREATE CONSTRAINT ir_codeunit_unique IF NOT EXISTS FOR (u:CodeUnit) REQUIRE (u.knowledgeId, u.unitId) IS UNIQUE",

  // Global concept nodes
  "CREATE CONSTRAINT ir_keyword_unique IF NOT EXISTS FOR (k:Keyword) REQUIRE (k.name) IS UNIQUE",
  "CREATE CONSTRAINT ir_ontology_unique IF NOT EXISTS FOR (o:OntologyConcept) REQUIRE (o.name) IS UNIQUE",
  "CREATE CONSTRAINT ir_busent_unique IF NOT EXISTS FOR (b:BusinessEntity) REQUIRE (b.name) IS UNIQUE",
  "CREATE CONSTRAINT ir_syscap_unique IF NOT EXISTS FOR (s:SystemCapability) REQUIRE (s.name) IS UNIQUE",
  "CREATE CONSTRAINT ir_cfgdep_unique IF NOT EXISTS FOR (c:ConfigDependency) REQUIRE (c.key) IS UNIQUE",
  "CREATE CONSTRAINT ir_integ_unique IF NOT EXISTS FOR (i:IntegrationSurface) REQUIRE (i.name) IS UNIQUE",
  "CREATE CONSTRAINT ir_unresolved_unique IF NOT EXISTS FOR (u:UnresolvedCallee) REQUIRE (u.name) IS UNIQUE",

  // Repo-scoped concept nodes
  "CREATE CONSTRAINT ir_class_unique IF NOT EXISTS FOR (c:Class) REQUIRE (c.knowledgeId, c.signature) IS UNIQUE",
  "CREATE CONSTRAINT ir_function_unique IF NOT EXISTS FOR (f:Function) REQUIRE (f.knowledgeId, f.signature) IS UNIQUE",
  "CREATE CONSTRAINT ir_export_unique IF NOT EXISTS FOR (e:ExportedSymbol) REQUIRE (e.knowledgeId, e.name) IS UNIQUE",
  "CREATE CONSTRAINT ir_module_unique IF NOT EXISTS FOR (m:ImportedModule) REQUIRE (m.knowledgeId, m.spec) IS UNIQUE",
  "CREATE CONSTRAINT ir_contract_unique IF NOT EXISTS FOR (c:Contract) REQUIRE (c.knowledgeId, c.name, c.shape) IS UNIQUE",

  // Per-file structural nodes
  "CREATE CONSTRAINT ir_pubsig_unique IF NOT EXISTS FOR (p:PublicSignature) REQUIRE (p.knowledgeId, p.fileId, p.kind, p.name) IS UNIQUE",
  "CREATE CONSTRAINT ir_typeshape_unique IF NOT EXISTS FOR (t:TypeShape) REQUIRE (t.knowledgeId, t.fileId, t.name) IS UNIQUE",
  "CREATE CONSTRAINT ir_section_unique IF NOT EXISTS FOR (s:Section) REQUIRE (s.knowledgeId, s.fileId, s.name) IS UNIQUE",
  "CREATE CONSTRAINT ir_fileconst_unique IF NOT EXISTS FOR (f:FileConstant) REQUIRE (f.knowledgeId, f.fileId, f.name, f.value, f.kind) IS UNIQUE",
  "CREATE CONSTRAINT ir_layout_unique IF NOT EXISTS FOR (m:ModuleLayoutEntry) REQUIRE (m.knowledgeId, m.fileId, m.order) IS UNIQUE",
  "CREATE CONSTRAINT ir_statemodel_unique IF NOT EXISTS FOR (s:StateModel) REQUIRE (s.knowledgeId, s.fileId) IS UNIQUE",
  "CREATE CONSTRAINT ir_state_unique IF NOT EXISTS FOR (s:State) REQUIRE (s.knowledgeId, s.fileId, s.name) IS UNIQUE",

  // Global substrate nodes (content-hash keyed)
  "CREATE CONSTRAINT ir_verbatim_unique IF NOT EXISTS FOR (v:VerbatimLiteral) REQUIRE (v.kind, v.hash) IS UNIQUE",
  "CREATE CONSTRAINT ir_sideeffect_unique IF NOT EXISTS FOR (s:SideEffect) REQUIRE (s.category, s.value) IS UNIQUE",
  "CREATE CONSTRAINT ir_edgecase_unique IF NOT EXISTS FOR (e:EdgeCase) REQUIRE (e.hash) IS UNIQUE",
  "CREATE CONSTRAINT ir_boundary_unique IF NOT EXISTS FOR (b:BoundaryCondition) REQUIRE (b.hash) IS UNIQUE",
  "CREATE CONSTRAINT ir_errhandle_unique IF NOT EXISTS FOR (e:ErrorHandlingItem) REQUIRE (e.hash) IS UNIQUE",
  "CREATE CONSTRAINT ir_invariant_unique IF NOT EXISTS FOR (i:Invariant) REQUIRE (i.hash) IS UNIQUE",
  "CREATE CONSTRAINT ir_diagnotice_unique IF NOT EXISTS FOR (d:DiagnosticNote) REQUIRE (d.hash) IS UNIQUE",
  "CREATE CONSTRAINT ir_assumption_unique IF NOT EXISTS FOR (a:Assumption) REQUIRE (a.hash) IS UNIQUE",
  "CREATE CONSTRAINT ir_ambiguity_unique IF NOT EXISTS FOR (a:Ambiguity) REQUIRE (a.hash) IS UNIQUE",
];

const RANGE_INDEXES = [
  "CREATE INDEX ir_file_path IF NOT EXISTS FOR (f:File) ON (f.knowledgeId, f.relativePath)",
  "CREATE INDEX ir_chunk_path IF NOT EXISTS FOR (c:Chunk) ON (c.knowledgeId, c.relativePath)",
  "CREATE INDEX ir_codeunit_qname IF NOT EXISTS FOR (u:CodeUnit) ON (u.knowledgeId, u.qualifiedName)",
  "CREATE INDEX ir_codeunit_fileid IF NOT EXISTS FOR (u:CodeUnit) ON (u.knowledgeId, u.fileId)",
];

const FULLTEXT_INDEXES = [
  "CREATE FULLTEXT INDEX idx_ir_file_semantic_ft IF NOT EXISTS FOR (f:File) ON EACH [f.purpose, f.summary, f.businessContext]",
  "CREATE FULLTEXT INDEX idx_ir_chunk_semantic_ft IF NOT EXISTS FOR (c:Chunk) ON EACH [c.purpose, c.summary, c.businessContext]",
  "CREATE FULLTEXT INDEX idx_ir_codeunit_name_ft IF NOT EXISTS FOR (u:CodeUnit) ON EACH [u.name, u.qualifiedName]",
  "CREATE FULLTEXT INDEX idx_ir_invariant_ft IF NOT EXISTS FOR (i:Invariant) ON EACH [i.description]",
  "CREATE FULLTEXT INDEX idx_ir_edgecase_ft IF NOT EXISTS FOR (e:EdgeCase) ON EACH [e.inputShape, e.behavior]",
  "CREATE FULLTEXT INDEX idx_ir_assumption_ft IF NOT EXISTS FOR (a:Assumption) ON EACH [a.description]",
];

/**
 * Idempotent IR graph-schema bootstrap. Run once per process before the first
 * `storeIrFileAnalysis` / `storeIrChunkAnalysis` call. Safe to re-issue and safe
 * to call after `ensureFlatFolderIndexes()` / `ensureKnowledgeIndexes()` — every
 * statement is guarded by `IF NOT EXISTS` plus an `EquivalentSchemaRuleAlreadyExists`
 * fallback so duplicate constraints just no-op.
 */
export async function ensureIrGraphSchema(): Promise<void> {
  for (const cypher of [...CONSTRAINTS, ...RANGE_INDEXES, ...FULLTEXT_INDEXES]) {
    try {
      await runCypher(cypher);
    } catch (cause: unknown) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (msg.includes("already exists") || msg.includes("EquivalentSchemaRuleAlreadyExists")) {
        continue;
      }
      throw cause;
    }
  }
}
