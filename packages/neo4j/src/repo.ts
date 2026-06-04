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
  /** GitHub owner — persisted to RepoSummary.user_name (matches the on-disk clone path segment). */
  owner: string;
  /** Bare repo name — persisted to RepoSummary.repo_name (matches the on-disk clone path segment). */
  repo: string;
  /** Resolved commit hash — persisted to RepoSummary.commit_hash and Knowledge.commit_hash. */
  commitHash: string;
  summary: RepoSummaryPayload;
}

// Dual-writes :Knowledge (snake_case) + :RepoSummary (snake_case) alongside
// :Repo so the chat-mcp legacy-schema reader (which queries
// (:Knowledge {org_id}) and (:Knowledge)-[:HAS_REPO_SUMMARY]->(:RepoSummary))
// finds every ingested repo. The :Knowledge node carries both knowledge_id
// (snake) and knowledgeId (camel) on the same node so a later
// upsertKnowledgeNode() call MERGEs into it rather than creating a duplicate.
const UPSERT_REPO = `
MERGE (k:Knowledge {knowledge_id: $knowledgeId})
ON CREATE SET k.created_at = $updatedAt
SET k.org_id = $orgId,
    k.knowledgeId = $knowledgeId,
    k.repository_name = $repoName,
    k.repo_name = $repoName,
    k.display_name = $repoName,
    k.branch_name = $branch,
    k.commit_hash = $commitHash,
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
SET rs.repo_name = $repo,
    rs.user_name = $owner,
    rs.commit_hash = $commitHash,
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
    owner: input.owner,
    repo: input.repo,
    commitHash: input.commitHash,
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
