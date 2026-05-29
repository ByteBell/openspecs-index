import { _runCypher, _runInTransaction, type CypherStep } from "./client.ts";
import { folderLevel, parentFolderPath } from "./pathUtils.ts";
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
  /** Display name for the repo this folder belongs to (e.g. "owner/repo"). Used on the :FolderNode legacy mirror. */
  repoName?: string;
  /** Branch this folder belongs to. Used on the :FolderNode legacy mirror. Defaults to empty string. */
  branch?: string;
}

// Primary :Folder upsert (camelCase, new pipeline) + legacy :FolderNode mirror
// (snake_case) so the chat-mcp reader (graph_traverse / retrieve_file) can find
// folders via (:Knowledge)-[:HAS_FOLDER]->(:FolderNode). The :CONTAINS_FOLDER
// edge between parent and child :FolderNode is established by a separate step
// (see ATTACH_FOLDERNODE_PARENT_EDGE / BATCH_ATTACH_FOLDERNODE_PARENT_EDGES)
// so parent-before-child ordering within a batch is irrelevant.
const UPSERT_FOLDER = `
MERGE (folder:Folder {orgId: $orgId, knowledgeId: $knowledgeId, repoId: $repoId, folderPath: $folderPath})
SET folder.purpose = $purpose,
    folder.summary = $summary,
    folder.dependencyGraph = $dependencyGraph,
    folder.updatedAt = $updatedAt
WITH folder
MATCH (r:Repo {orgId: $orgId, knowledgeId: $knowledgeId, repoId: $repoId})
MERGE (r)-[:CONTAINS]->(folder)
WITH folder
MERGE (fnode:FolderNode {knowledge_id: $knowledgeId, relative_path: $folderPath})
ON CREATE SET fnode.created_at = $updatedAt
SET fnode.org_id = $orgId,
    fnode.repo_name = $repoName,
    fnode.purpose = $purpose,
    fnode.summary = $summary,
    fnode.dependency_graph = $dependencyGraph,
    fnode.level = $level,
    fnode.branch_name = $branchName,
    fnode.commit_hash = '',
    fnode.updated_at = $updatedAt
WITH fnode
MATCH (k:Knowledge {knowledge_id: $knowledgeId})
MERGE (k)-[:HAS_FOLDER]->(fnode)
`;

const ATTACH_FOLDERNODE_PARENT_EDGE = `
MATCH (child:FolderNode {knowledge_id: $knowledgeId, relative_path: $folderPath})
MATCH (parent:FolderNode {knowledge_id: $knowledgeId, relative_path: $parentPath})
MERGE (parent)-[:CONTAINS_FOLDER]->(child)
`;

const CLEAR_FOLDER_KEYWORDS = `
MATCH (folder:Folder {orgId: $orgId, knowledgeId: $knowledgeId, repoId: $repoId, folderPath: $folderPath})-[rel:HAS_KEYWORD]->()
DELETE rel
`;

const ATTACH_FOLDER_KEYWORDS = `
MATCH (folder:Folder {orgId: $orgId, knowledgeId: $knowledgeId, repoId: $repoId, folderPath: $folderPath})
UNWIND $names AS name
MERGE (kw:Keyword {name: name})
MERGE (folder)-[:HAS_KEYWORD]->(kw)
`;

// ─────────────────────────────────────────────────────────────────────────────
// Batched folder upsert. Same Cypher shape as the single-shot path; wrapped
// with an outer UNWIND so one transaction lands every folder in the batch.
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_UPSERT_FOLDERS = `
UNWIND $folders AS fld
MERGE (folder:Folder {orgId: fld.orgId, knowledgeId: fld.knowledgeId, repoId: fld.repoId, folderPath: fld.folderPath})
SET folder.purpose = fld.purpose,
    folder.summary = fld.summary,
    folder.dependencyGraph = fld.dependencyGraph,
    folder.updatedAt = $updatedAt
WITH folder, fld
MATCH (r:Repo {orgId: fld.orgId, knowledgeId: fld.knowledgeId, repoId: fld.repoId})
MERGE (r)-[:CONTAINS]->(folder)
WITH folder, fld
MERGE (fnode:FolderNode {knowledge_id: fld.knowledgeId, relative_path: fld.folderPath})
ON CREATE SET fnode.created_at = $updatedAt
SET fnode.org_id = fld.orgId,
    fnode.repo_name = fld.repoName,
    fnode.purpose = fld.purpose,
    fnode.summary = fld.summary,
    fnode.dependency_graph = fld.dependencyGraph,
    fnode.level = fld.level,
    fnode.branch_name = fld.branchName,
    fnode.commit_hash = '',
    fnode.updated_at = $updatedAt
WITH fnode, fld
MATCH (k:Knowledge {knowledge_id: fld.knowledgeId})
MERGE (k)-[:HAS_FOLDER]->(fnode)
`;

const BATCH_ATTACH_FOLDERNODE_PARENT_EDGES = `
UNWIND $pairs AS p
MATCH (child:FolderNode {knowledge_id: p.knowledgeId, relative_path: p.folderPath})
MATCH (parent:FolderNode {knowledge_id: p.knowledgeId, relative_path: p.parentPath})
MERGE (parent)-[:CONTAINS_FOLDER]->(child)
`;

const BATCH_CLEAR_FOLDER_KEYWORDS = `
UNWIND $folders AS fld
MATCH (folder:Folder {orgId: fld.orgId, knowledgeId: fld.knowledgeId, repoId: fld.repoId, folderPath: fld.folderPath})-[rel:HAS_KEYWORD]->()
DELETE rel
`;

const BATCH_ATTACH_FOLDER_KEYWORDS = `
UNWIND $pairs AS p
MATCH (folder:Folder {orgId: p.orgId, knowledgeId: p.knowledgeId, repoId: p.repoId, folderPath: p.folderPath})
MERGE (kw:Keyword {name: p.name})
MERGE (folder)-[:HAS_KEYWORD]->(kw)
`;

export async function upsertFolderNodesBatch(inputs: readonly UpsertFolderNodeInput[]): Promise<void> {
  if (inputs.length === 0) {
    return;
  }
  const updatedAt = new Date().toISOString();
  const folders = inputs.map((input) => ({
    orgId: input.scope.orgId,
    knowledgeId: input.scope.knowledgeId,
    repoId: input.scope.repoId,
    folderPath: input.folderPath,
    purpose: input.summary.purpose,
    summary: input.summary.summary,
    dependencyGraph: input.summary.dependencyGraph,
    repoName: input.repoName ?? "",
    branchName: input.branch ?? "",
    level: folderLevel(input.folderPath),
  }));
  const folderKeys = inputs.map((input) => ({
    orgId: input.scope.orgId,
    knowledgeId: input.scope.knowledgeId,
    repoId: input.scope.repoId,
    folderPath: input.folderPath,
  }));
  const parentPairs: Array<{ knowledgeId: string; folderPath: string; parentPath: string }> = [];
  for (const input of inputs) {
    const parent = parentFolderPath(input.folderPath);
    if (parent !== null) {
      parentPairs.push({
        knowledgeId: input.scope.knowledgeId,
        folderPath: input.folderPath,
        parentPath: parent,
      });
    }
  }
  const keywordPairs: Array<Record<string, string>> = [];
  for (const input of inputs) {
    for (const raw of input.summary.keywords) {
      keywordPairs.push({
        orgId: input.scope.orgId,
        knowledgeId: input.scope.knowledgeId,
        repoId: input.scope.repoId,
        folderPath: input.folderPath,
        name: raw.toLowerCase(),
      });
    }
  }

  const steps: CypherStep[] = [
    { query: BATCH_UPSERT_FOLDERS, params: { folders, updatedAt } },
    { query: BATCH_CLEAR_FOLDER_KEYWORDS, params: { folders: folderKeys } },
  ];
  if (parentPairs.length > 0) {
    steps.push({ query: BATCH_ATTACH_FOLDERNODE_PARENT_EDGES, params: { pairs: parentPairs } });
  }
  if (keywordPairs.length > 0) {
    steps.push({ query: BATCH_ATTACH_FOLDER_KEYWORDS, params: { pairs: keywordPairs } });
  }

  await _runInTransaction(steps);
}

export async function upsertFolderNode(input: UpsertFolderNodeInput): Promise<void> {
  const scope = input.scope;
  const params = {
    orgId: scope.orgId,
    knowledgeId: scope.knowledgeId,
    repoId: scope.repoId,
    folderPath: input.folderPath,
  };
  await _runCypher(UPSERT_FOLDER, {
    ...params,
    purpose: input.summary.purpose,
    summary: input.summary.summary,
    dependencyGraph: input.summary.dependencyGraph,
    repoName: input.repoName ?? "",
    branchName: input.branch ?? "",
    level: folderLevel(input.folderPath),
    updatedAt: new Date().toISOString(),
  });
  const parent = parentFolderPath(input.folderPath);
  if (parent !== null) {
    await _runCypher(ATTACH_FOLDERNODE_PARENT_EDGE, {
      knowledgeId: scope.knowledgeId,
      folderPath: input.folderPath,
      parentPath: parent,
    });
  }
  await _runCypher(CLEAR_FOLDER_KEYWORDS, params);
  if (input.summary.keywords.length > 0) {
    await _runCypher(ATTACH_FOLDER_KEYWORDS, {
      ...params,
      names: input.summary.keywords.map((k) => k.toLowerCase()),
    });
  }
}
