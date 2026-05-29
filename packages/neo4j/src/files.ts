import { _runCypher, _runInTransaction, type CypherStep } from "./client.ts";
import {
  ATTACH_CLASSES,
  ATTACH_FILE_TO_FOLDER,
  ATTACH_FILE_TO_FOLDERNODE,
  ATTACH_FUNCTIONS,
  ATTACH_IMPORTS_EXTERNAL,
  ATTACH_IMPORTS_INTERNAL,
  ATTACH_KEYWORDS,
  CLEAR_CLASSES,
  CLEAR_FUNCTIONS,
  CLEAR_IMPORTS_EXTERNAL,
  CLEAR_IMPORTS_INTERNAL,
  CLEAR_KEYWORDS,
  DELETE_FILES,
  UPSERT_FILE,
} from "./filesCypher.ts";
import {
  BATCH_ATTACH_CLASSES,
  BATCH_ATTACH_FILES_TO_FOLDERNODES,
  BATCH_ATTACH_FILES_TO_FOLDERS,
  BATCH_ATTACH_FUNCTIONS,
  BATCH_ATTACH_IMPORTS_EXTERNAL,
  BATCH_ATTACH_IMPORTS_INTERNAL,
  BATCH_ATTACH_KEYWORDS,
  BATCH_CLEAR_RELS_BY_TYPE,
  BATCH_UPSERT_FILES,
} from "./filesCypherBatch.ts";
import { fileRowFor, flattenPairs, type FileRow, type UpsertFileNodeInput } from "./filesParams.ts";
import { buildOrgKeywordMirrorSteps, mirrorFileOrgKeywords, type MirrorFileInput } from "./legacyOrgKeywordMirror.ts";
import { basename, parentFolderPath } from "./pathUtils.ts";

export type { UpsertFileNodeInput } from "./filesParams.ts";

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
  const orgId = input.orgId ?? "local";
  await _runCypher(UPSERT_FILE, {
    ...params,
    orgId,
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
    sectionMapJson: JSON.stringify(sectionMap),
    keywords: input.analysis.keywords ?? [],
    classes: input.analysis.classes ?? [],
    functions: input.analysis.functions ?? [],
    importsInternal: input.analysis.importsInternal ?? [],
    importsExternal: input.analysis.importsExternal ?? [],
    isBigFile: input.isBigFile ?? false,
    totalChunks: input.totalChunks ?? 0,
    totalTokenCount: input.totalTokenCount ?? 0,
    nodeId: `${input.knowledgeId}::${input.relativePath}`,
    name: basename(input.relativePath),
    repoName: input.repoName ?? "",
    branchName: input.branch ?? "",
    updatedAt: new Date().toISOString(),
  });

  if (input.folderPath !== undefined) {
    await _runCypher(ATTACH_FILE_TO_FOLDER, { ...params, folderPath: input.folderPath });
  }
  const parentPath = parentFolderPath(input.relativePath);
  if (parentPath !== null) {
    await _runCypher(ATTACH_FILE_TO_FOLDERNODE, { ...params, parentPath });
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

  // Legacy :OrgKeyword mirror so chat-mcp search tools find this file.
  await mirrorFileOrgKeywords({
    knowledgeId: input.knowledgeId,
    relativePath: input.relativePath,
    orgId,
    analysis: input.analysis,
  });
}

export async function upsertFileNodesBatch(inputs: readonly UpsertFileNodeInput[]): Promise<void> {
  if (inputs.length === 0) {
    return;
  }
  const updatedAt = new Date().toISOString();
  const files = inputs.map((input) => fileRowFor(input));
  const fileKeys: FileRow[] = inputs.map((input) => ({
    knowledgeId: input.knowledgeId,
    relativePath: input.relativePath,
  }));
  const folderPairs = inputs
    .filter((input): input is UpsertFileNodeInput & { folderPath: string } => input.folderPath !== undefined)
    .map((input) => ({
      knowledgeId: input.knowledgeId,
      relativePath: input.relativePath,
      folderPath: input.folderPath,
    }));
  // Legacy :FolderNode -[:CONTAINS_FILE]-> :FileNode pairs, derived from the
  // file's own relative_path. We only push when the parent path is non-empty;
  // root-level files have no parent FolderNode and the reader handles that.
  const folderNodePairs: Array<{ knowledgeId: string; relativePath: string; parentPath: string }> = [];
  for (const input of inputs) {
    const parent = parentFolderPath(input.relativePath);
    if (parent !== null) {
      folderNodePairs.push({
        knowledgeId: input.knowledgeId,
        relativePath: input.relativePath,
        parentPath: parent,
      });
    }
  }

  const keywordPairs = flattenPairs(inputs, "keywords", "name", (v) => v.toLowerCase());
  const classPairs = flattenPairs(inputs, "classes", "signature");
  const functionPairs = flattenPairs(inputs, "functions", "signature");
  const importsInternalPairs = flattenPairs(inputs, "importsInternal", "name");
  const importsExternalPairs = flattenPairs(inputs, "importsExternal", "name");

  const steps: CypherStep[] = [{ query: BATCH_UPSERT_FILES, params: { files, updatedAt } }];
  if (folderPairs.length > 0) {
    steps.push({ query: BATCH_ATTACH_FILES_TO_FOLDERS, params: { pairs: folderPairs } });
  }
  if (folderNodePairs.length > 0) {
    steps.push({ query: BATCH_ATTACH_FILES_TO_FOLDERNODES, params: { pairs: folderNodePairs } });
  }
  // Clear existing rels of every type for every file in the batch.
  for (const relType of [
    "HAS_KEYWORD",
    "HAS_CLASS",
    "HAS_FUNCTION",
    "HAS_IMPORT_INTERNAL",
    "HAS_IMPORT_EXTERNAL",
  ] as const) {
    steps.push({ query: BATCH_CLEAR_RELS_BY_TYPE[relType], params: { files: fileKeys } });
  }
  if (keywordPairs.length > 0) {
    steps.push({ query: BATCH_ATTACH_KEYWORDS, params: { pairs: keywordPairs } });
  }
  if (classPairs.length > 0) {
    steps.push({ query: BATCH_ATTACH_CLASSES, params: { pairs: classPairs } });
  }
  if (functionPairs.length > 0) {
    steps.push({ query: BATCH_ATTACH_FUNCTIONS, params: { pairs: functionPairs } });
  }
  if (importsInternalPairs.length > 0) {
    steps.push({ query: BATCH_ATTACH_IMPORTS_INTERNAL, params: { pairs: importsInternalPairs } });
  }
  if (importsExternalPairs.length > 0) {
    steps.push({ query: BATCH_ATTACH_IMPORTS_EXTERNAL, params: { pairs: importsExternalPairs } });
  }
  // Legacy :OrgKeyword mirror — same transaction so primary FileNode +
  // legacy search graph are consistent for the batch as a whole.
  const mirrorInputs: MirrorFileInput[] = inputs.map((input) => ({
    knowledgeId: input.knowledgeId,
    relativePath: input.relativePath,
    orgId: input.orgId ?? "local",
    analysis: input.analysis,
  }));
  steps.push(...buildOrgKeywordMirrorSteps(mirrorInputs, updatedAt));

  await _runInTransaction(steps);
}
