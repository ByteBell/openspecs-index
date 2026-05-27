import { _runInTransaction, type CypherStep } from "./client.ts";
import type { UpsertFileNodeInput } from "./files.ts";

const BATCH_UPSERT_FILES = `
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
    file.isBigFile = f.isBigFile,
    file.totalChunks = f.totalChunks,
    file.totalTokenCount = f.totalTokenCount,
    file.updatedAt = $updatedAt
WITH file, f
MATCH (k:Knowledge {knowledgeId: f.knowledgeId})
MERGE (k)-[:HAS_FILE]->(file)
`;

const BATCH_ATTACH_FILES_TO_FOLDERS = `
UNWIND $pairs AS pair
MATCH (file:File {knowledgeId: pair.knowledgeId, relativePath: pair.relativePath})
MATCH (folder:Folder {knowledgeId: pair.knowledgeId, folderPath: pair.folderPath})
MERGE (folder)-[:CONTAINS]->(file)
`;

type RelType = "HAS_KEYWORD" | "HAS_CLASS" | "HAS_FUNCTION" | "HAS_IMPORT_INTERNAL" | "HAS_IMPORT_EXTERNAL";

const BATCH_CLEAR_RELS_BY_TYPE: Readonly<Record<RelType, string>> = {
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

const BATCH_ATTACH_KEYWORDS = `
UNWIND $pairs AS p
MATCH (file:File {knowledgeId: p.knowledgeId, relativePath: p.relativePath})
MERGE (kw:Keyword {name: p.name})
MERGE (file)-[:HAS_KEYWORD]->(kw)
`;

const BATCH_ATTACH_CLASSES = `
UNWIND $pairs AS p
MATCH (file:File {knowledgeId: p.knowledgeId, relativePath: p.relativePath})
MERGE (c:Class {signature: p.signature})
MERGE (file)-[:HAS_CLASS]->(c)
`;

const BATCH_ATTACH_FUNCTIONS = `
UNWIND $pairs AS p
MATCH (file:File {knowledgeId: p.knowledgeId, relativePath: p.relativePath})
MERGE (fn:Function {signature: p.signature})
MERGE (file)-[:HAS_FUNCTION]->(fn)
`;

const BATCH_ATTACH_IMPORTS_INTERNAL = `
UNWIND $pairs AS p
MATCH (file:File {knowledgeId: p.knowledgeId, relativePath: p.relativePath})
MERGE (m:Module {name: p.name})
MERGE (file)-[:HAS_IMPORT_INTERNAL]->(m)
`;

const BATCH_ATTACH_IMPORTS_EXTERNAL = `
UNWIND $pairs AS p
MATCH (file:File {knowledgeId: p.knowledgeId, relativePath: p.relativePath})
MERGE (m:Module {name: p.name})
MERGE (file)-[:HAS_IMPORT_EXTERNAL]->(m)
`;

interface FileRow {
  knowledgeId: string;
  relativePath: string;
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

  const keywordPairs = flattenPairs(inputs, "keywords", "name", (v) => v.toLowerCase());
  const classPairs = flattenPairs(inputs, "classes", "signature");
  const functionPairs = flattenPairs(inputs, "functions", "signature");
  const importsInternalPairs = flattenPairs(inputs, "importsInternal", "name");
  const importsExternalPairs = flattenPairs(inputs, "importsExternal", "name");

  const steps: CypherStep[] = [{ query: BATCH_UPSERT_FILES, params: { files, updatedAt } }];
  if (folderPairs.length > 0) {
    steps.push({ query: BATCH_ATTACH_FILES_TO_FOLDERS, params: { pairs: folderPairs } });
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

  await _runInTransaction(steps);
}

function fileRowFor(input: UpsertFileNodeInput): Record<string, unknown> {
  const sectionMap = input.analysis.sectionMap ?? [];
  return {
    knowledgeId: input.knowledgeId,
    relativePath: input.relativePath,
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
  };
}

function flattenPairs(
  inputs: readonly UpsertFileNodeInput[],
  field: "keywords" | "classes" | "functions" | "importsInternal" | "importsExternal",
  valueKey: "name" | "signature",
  normalize?: (v: string) => string,
): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const input of inputs) {
    const values = input.analysis[field];
    if (!Array.isArray(values)) {
      continue;
    }
    for (const raw of values) {
      const value = normalize !== undefined ? normalize(raw) : raw;
      out.push({ knowledgeId: input.knowledgeId, relativePath: input.relativePath, [valueKey]: value });
    }
  }
  return out;
}
