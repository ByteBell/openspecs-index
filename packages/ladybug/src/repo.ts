import { _runCypher } from "./client.ts";

export interface NodeScope {
  orgId: string;
  knowledgeId: string;
  repoId: string;
}

export interface RepoSummaryPayload {
  purpose: string;
  summary: string;
  keywords: string[];
  architecture: string;
  dataFlow: string;
  majorSubsystems: string[];
  keyPatterns: string[];
}

export interface UpsertRepoNodeInput {
  scope: NodeScope;
  repoUrl: string;
  branch: string;
  summary: RepoSummaryPayload;
}

const UPSERT_REPO = `
MERGE (r:Repo {id: $id})
SET r.orgId = $orgId,
    r.knowledgeId = $knowledgeId,
    r.repoId = $repoId,
    r.repoUrl = $repoUrl,
    r.branch = $branch,
    r.purpose = $purpose,
    r.summary = $summary,
    r.architecture = $architecture,
    r.dataFlow = $dataFlow,
    r.majorSubsystems = $majorSubsystems,
    r.keyPatterns = $keyPatterns,
    r.updatedAt = $updatedAt
WITH r
MATCH (k:Knowledge {knowledgeId: $knowledgeId})
MERGE (k)-[:HAS_REPO]->(r)
`;

const CLEAR_REPO_KEYWORDS = `
MATCH (r:Repo {id: $id})-[rel:HAS_KEYWORD]->()
DELETE rel
`;

const ATTACH_REPO_KEYWORDS = `
MATCH (r:Repo {id: $id})
UNWIND $names AS name
MERGE (kw:Keyword {name: name})
CREATE (r)-[:HAS_KEYWORD]->(kw)
`;

export async function upsertRepoNode(input: UpsertRepoNodeInput): Promise<void> {
  const scope = input.scope;
  const id = `${scope.orgId}::${scope.knowledgeId}::${scope.repoId}`;

  await _runCypher(UPSERT_REPO, {
    id,
    orgId: scope.orgId,
    knowledgeId: scope.knowledgeId,
    repoId: scope.repoId,
    repoUrl: input.repoUrl,
    branch: input.branch,
    purpose: input.summary.purpose,
    summary: input.summary.summary,
    architecture: input.summary.architecture,
    dataFlow: input.summary.dataFlow,
    majorSubsystems: input.summary.majorSubsystems,
    keyPatterns: input.summary.keyPatterns,
    updatedAt: new Date().toISOString(),
  });

  await _runCypher(CLEAR_REPO_KEYWORDS, { id });

  if (input.summary.keywords.length > 0) {
    await _runCypher(ATTACH_REPO_KEYWORDS, {
      id,
      names: input.summary.keywords.map((k) => k.toLowerCase()),
    });
  }
}
