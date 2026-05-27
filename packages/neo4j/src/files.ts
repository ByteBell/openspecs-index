import type { FileAnalysis } from "@bb/mongo";
import { _runCypher } from "./client.ts";

export { upsertFileNodesBatch } from "./files-batch.ts";

export interface UpsertFileNodeInput {
  orgId?: string;
  knowledgeId: string;
  repoId?: string;
  relativePath: string;
  language: string;
  sha: string;
  sizeBytes: number;
  analysis: FileAnalysis;
  folderPath?: string;
  isBigFile?: boolean;
  totalChunks?: number;
  totalTokenCount?: number;
}

const UPSERT_FILE = `
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
    f.isBigFile = $isBigFile,
    f.totalChunks = $totalChunks,
    f.totalTokenCount = $totalTokenCount,
    f.updatedAt = $updatedAt
WITH f
MATCH (k:Knowledge {knowledgeId: $knowledgeId})
MERGE (k)-[:HAS_FILE]->(f)
`;

const ATTACH_FILE_TO_FOLDER = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
MATCH (folder:Folder {knowledgeId: $knowledgeId, folderPath: $folderPath})
MERGE (folder)-[:CONTAINS]->(f)
`;

const CLEAR_KEYWORDS = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})-[r:HAS_KEYWORD]->()
DELETE r
`;

const CLEAR_CLASSES = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})-[r:HAS_CLASS]->()
DELETE r
`;

const CLEAR_FUNCTIONS = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})-[r:HAS_FUNCTION]->()
DELETE r
`;

const CLEAR_IMPORTS_INTERNAL = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})-[r:HAS_IMPORT_INTERNAL]->()
DELETE r
`;

const CLEAR_IMPORTS_EXTERNAL = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})-[r:HAS_IMPORT_EXTERNAL]->()
DELETE r
`;

const ATTACH_KEYWORDS = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
UNWIND $names AS name
MERGE (kw:Keyword {name: name})
MERGE (f)-[:HAS_KEYWORD]->(kw)
`;

const ATTACH_CLASSES = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
UNWIND $signatures AS signature
MERGE (c:Class {signature: signature})
MERGE (f)-[:HAS_CLASS]->(c)
`;

const ATTACH_FUNCTIONS = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
UNWIND $signatures AS signature
MERGE (fn:Function {signature: signature})
MERGE (f)-[:HAS_FUNCTION]->(fn)
`;

const ATTACH_IMPORTS_INTERNAL = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
UNWIND $names AS name
MERGE (m:Module {name: name})
MERGE (f)-[:HAS_IMPORT_INTERNAL]->(m)
`;

const ATTACH_IMPORTS_EXTERNAL = `
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
UNWIND $names AS name
MERGE (m:Module {name: name})
MERGE (f)-[:HAS_IMPORT_EXTERNAL]->(m)
`;

const DELETE_FILES = `
MATCH (f:File {knowledgeId: $knowledgeId})
WHERE f.relativePath IN $relativePaths
DETACH DELETE f
`;

/**
 * Removes the live `:File` nodes for `relativePaths` under `knowledgeId`,
 * along with their relationships. Callers that need history (e.g. the pull
 * worker) must call `snapshotFilesToVersion` first; this only touches the
 * live `:File` set, never `:FileVersion`.
 *
 * No-op when `relativePaths` is empty.
 */
export async function deleteFileNodes(knowledgeId: string, relativePaths: string[]): Promise<void> {
  if (relativePaths.length === 0) {
    return;
  }
  await _runCypher(DELETE_FILES, { knowledgeId, relativePaths });
}

export async function upsertFileNode(input: UpsertFileNodeInput): Promise<void> {
  const params = { knowledgeId: input.knowledgeId, relativePath: input.relativePath };
  const sectionMap = input.analysis.sectionMap ?? [];
  await _runCypher(UPSERT_FILE, {
    ...params,
    orgId: input.orgId ?? "local",
    repoId: input.repoId ?? input.knowledgeId,
    language: input.language,
    sha: input.sha,
    sizeBytes: input.sizeBytes,
    purpose: input.analysis.purpose,
    summary: input.analysis.summary,
    businessContext: input.analysis.businessContext,
    dataFlowDirection: input.analysis.dataFlowDirection ?? "",
    ontologyConcepts: input.analysis.ontologyConcepts ?? [],
    businessEntities: input.analysis.businessEntities ?? [],
    systemCapabilities: input.analysis.systemCapabilities ?? [],
    sideEffects: input.analysis.sideEffects ?? [],
    configDependencies: input.analysis.configDependencies ?? [],
    integrationSurface: input.analysis.integrationSurface ?? [],
    contractsProvided: input.analysis.contractsProvided ?? [],
    contractsConsumed: input.analysis.contractsConsumed ?? [],
    sectionNames: sectionMap.map((s) => s.name),
    sectionDescriptions: sectionMap.map((s) => s.description),
    isBigFile: input.isBigFile ?? false,
    totalChunks: input.totalChunks ?? 0,
    totalTokenCount: input.totalTokenCount ?? 0,
    updatedAt: new Date().toISOString(),
  });

  if (input.folderPath !== undefined) {
    await _runCypher(ATTACH_FILE_TO_FOLDER, { ...params, folderPath: input.folderPath });
  }

  await _runCypher(CLEAR_KEYWORDS, params);
  await _runCypher(CLEAR_CLASSES, params);
  await _runCypher(CLEAR_FUNCTIONS, params);
  await _runCypher(CLEAR_IMPORTS_INTERNAL, params);
  await _runCypher(CLEAR_IMPORTS_EXTERNAL, params);

  if (input.analysis.keywords.length > 0) {
    await _runCypher(ATTACH_KEYWORDS, { ...params, names: input.analysis.keywords.map((k) => k.toLowerCase()) });
  }
  if (input.analysis.classes.length > 0) {
    await _runCypher(ATTACH_CLASSES, { ...params, signatures: input.analysis.classes });
  }
  if (input.analysis.functions.length > 0) {
    await _runCypher(ATTACH_FUNCTIONS, { ...params, signatures: input.analysis.functions });
  }
  if (input.analysis.importsInternal.length > 0) {
    await _runCypher(ATTACH_IMPORTS_INTERNAL, { ...params, names: input.analysis.importsInternal });
  }
  if (input.analysis.importsExternal.length > 0) {
    await _runCypher(ATTACH_IMPORTS_EXTERNAL, { ...params, names: input.analysis.importsExternal });
  }
}
