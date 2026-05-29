// Batched Cypher used by the flat-folder indexing phase. Same shape as the
// single-shot constants in [filesCypher.ts](filesCypher.ts), wrapped in
// UNWIND so one query services every file in the batch and lands the whole
// set in one transaction. The five rel types (HAS_KEYWORD / HAS_CLASS /
// HAS_FUNCTION / HAS_IMPORT_INTERNAL / HAS_IMPORT_EXTERNAL) each take two
// Cyphers: a batched DELETE that clears existing rels for every file in
// the batch by relativePath, then a batched UNWIND that attaches the new
// rels from flattened (knowledgeId, relativePath, name) triples.

export type RelType = "HAS_KEYWORD" | "HAS_CLASS" | "HAS_FUNCTION" | "HAS_IMPORT_INTERNAL" | "HAS_IMPORT_EXTERNAL";

export const BATCH_UPSERT_FILES = `
UNWIND $files AS f
MERGE (file:File {knowledgeId: f.knowledgeId, relativePath: f.relativePath})
SET file.orgId = f.orgId,
    file.repoId = f.repoId,
    file.language = f.language,
    file.sha = f.sha,
    file.sizeBytes = f.sizeBytes,
    file.purpose = f.purpose,
    file.summary = f.summary,
    file.businessContext = f.businessContext,
    file.dataFlowDirection = f.dataFlowDirection,
    file.ontologyConcepts = f.ontologyConcepts,
    file.businessEntities = f.businessEntities,
    file.systemCapabilities = f.systemCapabilities,
    file.sideEffects = f.sideEffects,
    file.configDependencies = f.configDependencies,
    file.integrationSurface = f.integrationSurface,
    file.contractsProvided = f.contractsProvided,
    file.contractsConsumed = f.contractsConsumed,
    file.sectionNames = f.sectionNames,
    file.sectionDescriptions = f.sectionDescriptions,
    file.sectionsJson = f.sectionMapJson,
    file.isBigFile = f.isBigFile,
    file.totalChunks = f.totalChunks,
    file.totalTokenCount = f.totalTokenCount,
    file.updatedAt = $updatedAt
WITH file, f
MATCH (k:Knowledge {knowledgeId: f.knowledgeId})
MERGE (k)-[:HAS_FILE]->(file)
WITH file, f
MERGE (fn:FileNode {knowledge_id: f.knowledgeId, relative_path: f.relativePath})
ON CREATE SET fn.created_at = $updatedAt
SET fn.org_id = f.orgId,
    fn.node_id = f.nodeId,
    fn.name = f.name,
    fn.language = f.language,
    fn.purpose = f.purpose,
    fn.summary = f.summary,
    fn.business_context = f.businessContext,
    fn.section_map = f.sectionMapJson,
    fn.data_flow_direction = f.dataFlowDirection,
    fn.ontology_concepts = f.ontologyConcepts,
    fn.business_entities = f.businessEntities,
    fn.system_capabilities = f.systemCapabilities,
    fn.side_effects = f.sideEffects,
    fn.config_dependencies = f.configDependencies,
    fn.integration_surface = f.integrationSurface,
    fn.contracts_provided = f.contractsProvided,
    fn.contracts_consumed = f.contractsConsumed,
    fn.keywords = f.keywords,
    fn.classes = f.classes,
    fn.functions = f.functions,
    fn.imports_internal = f.importsInternal,
    fn.imports_external = f.importsExternal,
    fn.repo_name = f.repoName,
    fn.branch_name = f.branchName,
    fn.commit_hash = '',
    fn.updated_at = $updatedAt
WITH fn, f
MATCH (k2:Knowledge {knowledge_id: f.knowledgeId})
MERGE (k2)-[:HAS_FILE]->(fn)
`;

export const BATCH_ATTACH_FILES_TO_FOLDERNODES = `
UNWIND $pairs AS p
MATCH (fn:FileNode {knowledge_id: p.knowledgeId, relative_path: p.relativePath})
MATCH (parent:FolderNode {knowledge_id: p.knowledgeId, relative_path: p.parentPath})
MERGE (parent)-[:CONTAINS_FILE]->(fn)
`;

export const BATCH_ATTACH_FILES_TO_FOLDERS = `
UNWIND $pairs AS pair
MATCH (file:File {knowledgeId: pair.knowledgeId, relativePath: pair.relativePath})
MATCH (folder:Folder {knowledgeId: pair.knowledgeId, folderPath: pair.folderPath})
MERGE (folder)-[:CONTAINS]->(file)
`;

export const BATCH_CLEAR_RELS_BY_TYPE: Readonly<Record<RelType, string>> = {
  HAS_KEYWORD: `
UNWIND $files AS f
MATCH (file:File {knowledgeId: f.knowledgeId, relativePath: f.relativePath})-[r:HAS_KEYWORD]->()
DELETE r
`,
  HAS_CLASS: `
UNWIND $files AS f
MATCH (file:File {knowledgeId: f.knowledgeId, relativePath: f.relativePath})-[r:HAS_CLASS]->()
DELETE r
`,
  HAS_FUNCTION: `
UNWIND $files AS f
MATCH (file:File {knowledgeId: f.knowledgeId, relativePath: f.relativePath})-[r:HAS_FUNCTION]->()
DELETE r
`,
  HAS_IMPORT_INTERNAL: `
UNWIND $files AS f
MATCH (file:File {knowledgeId: f.knowledgeId, relativePath: f.relativePath})-[r:HAS_IMPORT_INTERNAL]->()
DELETE r
`,
  HAS_IMPORT_EXTERNAL: `
UNWIND $files AS f
MATCH (file:File {knowledgeId: f.knowledgeId, relativePath: f.relativePath})-[r:HAS_IMPORT_EXTERNAL]->()
DELETE r
`,
};

export const BATCH_ATTACH_KEYWORDS = `
UNWIND $pairs AS p
MATCH (file:File {knowledgeId: p.knowledgeId, relativePath: p.relativePath})
MERGE (kw:Keyword {name: p.name})
MERGE (file)-[:HAS_KEYWORD]->(kw)
`;

export const BATCH_ATTACH_CLASSES = `
UNWIND $pairs AS p
MATCH (file:File {knowledgeId: p.knowledgeId, relativePath: p.relativePath})
MERGE (c:Class {signature: p.signature})
MERGE (file)-[:HAS_CLASS]->(c)
`;

export const BATCH_ATTACH_FUNCTIONS = `
UNWIND $pairs AS p
MATCH (file:File {knowledgeId: p.knowledgeId, relativePath: p.relativePath})
MERGE (fn:Function {signature: p.signature})
MERGE (file)-[:HAS_FUNCTION]->(fn)
`;

export const BATCH_ATTACH_IMPORTS_INTERNAL = `
UNWIND $pairs AS p
MATCH (file:File {knowledgeId: p.knowledgeId, relativePath: p.relativePath})
MERGE (m:Module {name: p.name})
MERGE (file)-[:HAS_IMPORT_INTERNAL]->(m)
`;

export const BATCH_ATTACH_IMPORTS_EXTERNAL = `
UNWIND $pairs AS p
MATCH (file:File {knowledgeId: p.knowledgeId, relativePath: p.relativePath})
MERGE (m:Module {name: p.name})
MERGE (file)-[:HAS_IMPORT_EXTERNAL]->(m)
`;
