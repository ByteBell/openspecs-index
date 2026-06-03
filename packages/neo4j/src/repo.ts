import { _runCypher } from "./client.ts";
import { repoNameFromGithubUrl } from "./knowledge.ts";

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

// MERGEs the :Knowledge node on the canonical camelCase knowledgeId — the
// property the unique constraint is declared on (see indexes.ts) and the key
// upsertKnowledgeNode() also MERGEs on. Keying every :Knowledge MERGE on the
// same property is what lets the index-route (which creates the node first via
// upsertKnowledgeNode) and this worker-side upsert converge on one node instead
// of racing to CREATE a duplicate that trips the constraint.
// Alongside :Repo + :RepoSummary, it dual-writes the snake_case mirror
// properties (knowledge_id, org_id, repo_name, …) so the chat-mcp legacy-schema
// reader — which queries (:Knowledge {org_id}) and
// (:Knowledge)-[:HAS_REPO_SUMMARY]->(:RepoSummary) — still finds every repo.
const UPSERT_REPO = `
MERGE (k:Knowledge {knowledgeId: $knowledgeId})
ON CREATE SET k.created_at = $updatedAt
SET k.org_id = $orgId,
    k.knowledge_id = $knowledgeId,
    k.repository_name = $repoName,
    k.repo_name = $repoName,
    k.display_name = $repoName,
    k.branch_name = $branch,
    k.updated_at = $updatedAt
MERGE (r:Repo {orgId: $orgId, knowledgeId: $knowledgeId, repoId: $repoId})
SET r.repoUrl = $repoUrl,
    r.branch = $branch,
    r.purpose = $purpose,
    r.summary = $summary,
    r.architecture = $architecture,
    r.dataFlow = $dataFlow,
    r.majorSubsystems = $majorSubsystems,
    r.keyPatterns = $keyPatterns,
    r.updatedAt = $updatedAt
MERGE (k)-[:HAS_REPO]->(r)
MERGE (rs:RepoSummary {knowledge_id: $knowledgeId, org_id: $orgId, branch_name: $branch})
ON CREATE SET rs.generated_at = $updatedAt
SET rs.repo_name = $repoName,
    rs.commit_hash = '',
    rs.architecture = $architecture,
    rs.data_flow = $dataFlow,
    rs.key_patterns = $keyPatterns,
    rs.major_subsystems = $majorSubsystems,
    rs.purpose = $purpose,
    rs.summary = $summary,
    rs.tree = '',
    rs.updated_at = $updatedAt
MERGE (k)-[:HAS_REPO_SUMMARY]->(rs)
`;

const CLEAR_REPO_KEYWORDS = `
MATCH (r:Repo {orgId: $orgId, knowledgeId: $knowledgeId, repoId: $repoId})-[rel:HAS_KEYWORD]->()
DELETE rel
`;

const ATTACH_REPO_KEYWORDS = `
MATCH (r:Repo {orgId: $orgId, knowledgeId: $knowledgeId, repoId: $repoId})
UNWIND $names AS name
MERGE (kw:Keyword {name: name})
MERGE (r)-[:HAS_KEYWORD]->(kw)
`;

export async function upsertRepoNode(input: UpsertRepoNodeInput): Promise<void> {
  const scope = input.scope;
  await _runCypher(UPSERT_REPO, {
    orgId: scope.orgId,
    knowledgeId: scope.knowledgeId,
    repoId: scope.repoId,
    repoUrl: input.repoUrl,
    repoName: repoNameFromGithubUrl(input.repoUrl),
    branch: input.branch,
    purpose: input.summary.purpose,
    summary: input.summary.summary,
    architecture: input.summary.architecture,
    dataFlow: input.summary.dataFlow,
    majorSubsystems: input.summary.majorSubsystems,
    keyPatterns: input.summary.keyPatterns,
    updatedAt: new Date().toISOString(),
  });
  await _runCypher(CLEAR_REPO_KEYWORDS, { orgId: scope.orgId, knowledgeId: scope.knowledgeId, repoId: scope.repoId });
  if (input.summary.keywords.length > 0) {
    await _runCypher(ATTACH_REPO_KEYWORDS, {
      orgId: scope.orgId,
      knowledgeId: scope.knowledgeId,
      repoId: scope.repoId,
      names: input.summary.keywords.map((k) => k.toLowerCase()),
    });
  }
}
