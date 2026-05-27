import { _runCypher } from "./client.ts";
import type { NodeScope } from "./repo.ts";

export interface FolderSummaryPayload {
  purpose: string;
  summary: string;
  keywords: string[];
  classes: string[];
  functions: string[];
  importsInternal: string[];
  importsExternal: string[];
  dependencyGraph: string;
}

export interface UpsertFolderNodeInput {
  scope: NodeScope;
  folderPath: string;
  summary: FolderSummaryPayload;
}

const UPSERT_FOLDER = `
MERGE (folder:Folder {id: $id})
SET folder.orgId = $orgId,
    folder.knowledgeId = $knowledgeId,
    folder.repoId = $repoId,
    folder.folderPath = $folderPath,
    folder.purpose = $purpose,
    folder.summary = $summary,
    folder.dependencyGraph = $dependencyGraph,
    folder.updatedAt = $updatedAt
WITH folder
MATCH (r:Repo {id: $repoId_surrogate})
MERGE (r)-[:CONTAINS]->(folder)
`;

const CLEAR_FOLDER_KEYWORDS = `
MATCH (folder:Folder {id: $id})-[rel:HAS_KEYWORD]->()
DELETE rel
`;

const ATTACH_FOLDER_KEYWORDS = `
MATCH (folder:Folder {id: $id})
UNWIND $names AS name
MERGE (kw:Keyword {name: name})
CREATE (folder)-[:HAS_KEYWORD]->(kw)
`;

export async function upsertFolderNode(input: UpsertFolderNodeInput): Promise<void> {
  const scope = input.scope;
  const id = `${scope.orgId}::${scope.knowledgeId}::${scope.repoId}::${input.folderPath}`;
  const repoId_surrogate = `${scope.orgId}::${scope.knowledgeId}::${scope.repoId}`;

  const params = {
    id,
    orgId: scope.orgId,
    knowledgeId: scope.knowledgeId,
    repoId: scope.repoId,
    folderPath: input.folderPath,
    repoId_surrogate,
  };

  await _runCypher(UPSERT_FOLDER, {
    ...params,
    purpose: input.summary.purpose,
    summary: input.summary.summary,
    dependencyGraph: input.summary.dependencyGraph,
    updatedAt: new Date().toISOString(),
  });

  await _runCypher(CLEAR_FOLDER_KEYWORDS, { id });

  if (input.summary.keywords.length > 0) {
    await _runCypher(ATTACH_FOLDER_KEYWORDS, {
      id,
      names: input.summary.keywords.map((k) => k.toLowerCase()),
    });
  }
}
