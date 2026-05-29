// Single-shot Cypher for the per-file write path. Each constant here is
// consumed exactly once by [files.ts](files.ts) via _runCypher. The big
// UPSERT_FILE statement primary-writes :File (camelCase) and in the same
// transaction MERGEs the legacy :FileNode mirror (snake_case) plus the
// :Knowledge-[:HAS_FILE]->:FileNode edge.

export const UPSERT_FILE = `
MERGE (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
SET f.orgId = $orgId,
    f.repoId = $repoId,
    f.language = $language,
    f.sha = $sha,
    f.sizeBytes = $sizeBytes,
    f.purpose = $purpose,
    f.summary = $summary,
    f.businessContext = $businessContext,
    f.dataFlowDirection = $dataFlowDirection,
    f.ontologyConcepts = $ontologyConcepts,
    f.businessEntities = $businessEntities,
    f.systemCapabilities = $systemCapabilities,
    f.sideEffects = $sideEffects,
    f.configDependencies = $configDependencies,
    f.integrationSurface = $integrationSurface,
    f.contractsProvided = $contractsProvided,
    f.contractsConsumed = $contractsConsumed,
    f.sectionNames = $sectionNames,
    f.sectionDescriptions = $sectionDescriptions,
    f.sectionsJson = $sectionMapJson,
    f.isBigFile = $isBigFile,
    f.totalChunks = $totalChunks,
    f.totalTokenCount = $totalTokenCount,
    f.updatedAt = $updatedAt
WITH f
MATCH (k:Knowledge {knowledgeId: $knowledgeId})
MERGE (k)-[:HAS_FILE]->(f)
WITH f
MERGE (fn:FileNode {knowledge_id: $knowledgeId, relative_path: $relativePath})
ON CREATE SET fn.created_at = $updatedAt
SET fn.org_id = $orgId,
    fn.node_id = $nodeId,
    fn.name = $name,
    fn.language = $language,
    fn.purpose = $purpose,
    fn.summary = $summary,
    fn.business_context = $businessContext,
    fn.section_map = $sectionMapJson,
    fn.data_flow_direction = $dataFlowDirection,
    fn.ontology_concepts = $ontologyConcepts,
    fn.business_entities = $businessEntities,
    fn.system_capabilities = $systemCapabilities,
    fn.side_effects = $sideEffects,
    fn.config_dependencies = $configDependencies,
    fn.integration_surface = $integrationSurface,
    fn.contracts_provided = $contractsProvided,
    fn.contracts_consumed = $contractsConsumed,
    fn.keywords = $keywords,
    fn.classes = $classes,
    fn.functions = $functions,
    fn.imports_internal = $importsInternal,
    fn.imports_external = $importsExternal,
    fn.repo_name = $repoName,
    fn.branch_name = $branchName,
    fn.commit_hash = '',
    fn.updated_at = $updatedAt
WITH fn
MATCH (k2:Knowledge {knowledge_id: $knowledgeId})
MERGE (k2)-[:HAS_FILE]->(fn)
`;

export const ATTACH_FILE_TO_FOLDERNODE = `
MATCH (fn:FileNode {knowledge_id: $knowledgeId, relative_path: $relativePath})
MATCH (parent:FolderNode {knowledge_id: $knowledgeId, relative_path: $parentPath})
MERGE (parent)-[:CONTAINS_FILE]->(fn)
`;

export const ATTACH_FILE_TO_FOLDER = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
MATCH (folder:Folder {knowledgeId: $knowledgeId, folderPath: $folderPath})
MERGE (folder)-[:CONTAINS]->(f)
`;

export const CLEAR_KEYWORDS = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})-[r:HAS_KEYWORD]->()
DELETE r
`;

export const CLEAR_CLASSES = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})-[r:HAS_CLASS]->()
DELETE r
`;

export const CLEAR_FUNCTIONS = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})-[r:HAS_FUNCTION]->()
DELETE r
`;

export const CLEAR_IMPORTS_INTERNAL = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})-[r:HAS_IMPORT_INTERNAL]->()
DELETE r
`;

export const CLEAR_IMPORTS_EXTERNAL = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})-[r:HAS_IMPORT_EXTERNAL]->()
DELETE r
`;

export const ATTACH_KEYWORDS = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
UNWIND $names AS name
MERGE (kw:Keyword {name: name})
MERGE (f)-[:HAS_KEYWORD]->(kw)
`;

export const ATTACH_CLASSES = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
UNWIND $signatures AS signature
MERGE (c:Class {signature: signature})
MERGE (f)-[:HAS_CLASS]->(c)
`;

export const ATTACH_FUNCTIONS = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
UNWIND $signatures AS signature
MERGE (fn:Function {signature: signature})
MERGE (f)-[:HAS_FUNCTION]->(fn)
`;

export const ATTACH_IMPORTS_INTERNAL = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
UNWIND $names AS name
MERGE (m:Module {name: name})
MERGE (f)-[:HAS_IMPORT_INTERNAL]->(m)
`;

export const ATTACH_IMPORTS_EXTERNAL = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
UNWIND $names AS name
MERGE (m:Module {name: name})
MERGE (f)-[:HAS_IMPORT_EXTERNAL]->(m)
`;

export const DELETE_FILES = `
MATCH (f:File {knowledgeId: $knowledgeId})
WHERE f.relativePath IN $relativePaths
DETACH DELETE f
`;
