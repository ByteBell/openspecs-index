import { _runCypher } from "./client.ts";

const CONSTRAINTS = [
  "CREATE CONSTRAINT repo_unique IF NOT EXISTS FOR (r:Repo) REQUIRE (r.orgId, r.knowledgeId, r.repoId) IS UNIQUE",
  "CREATE CONSTRAINT folder_unique IF NOT EXISTS FOR (folder:Folder) REQUIRE (folder.orgId, folder.knowledgeId, folder.repoId, folder.folderPath) IS UNIQUE",
  // Legacy snake_case mirror — the chat-mcp reader keys :FileNode / :FolderNode
  // / :RepoSummary by these tuples. Same idempotent IF NOT EXISTS contract.
  "CREATE CONSTRAINT filenode_unique IF NOT EXISTS FOR (fn:FileNode) REQUIRE (fn.knowledge_id, fn.relative_path) IS UNIQUE",
  "CREATE CONSTRAINT foldernode_unique IF NOT EXISTS FOR (fn:FolderNode) REQUIRE (fn.knowledge_id, fn.relative_path) IS UNIQUE",
  "CREATE CONSTRAINT reposummary_unique IF NOT EXISTS FOR (rs:RepoSummary) REQUIRE (rs.knowledge_id, rs.org_id, rs.branch_name) IS UNIQUE",
  "CREATE CONSTRAINT orgkeyword_unique IF NOT EXISTS FOR (k:OrgKeyword) REQUIRE (k.keyword, k.type, k.org_id) IS UNIQUE",
];

const FULLTEXT_INDEXES = [
  "CREATE FULLTEXT INDEX idx_repo_purpose_summary_ft IF NOT EXISTS FOR (r:Repo) ON EACH [r.purpose, r.summary, r.architecture]",
  "CREATE FULLTEXT INDEX idx_folder_purpose_summary_ft IF NOT EXISTS FOR (folder:Folder) ON EACH [folder.purpose, folder.summary]",
  // Legacy snake_case mirror fulltext indexes consumed by chat-mcp:
  //   smart_search / graph_search (paths, purpose) — idx_filenode_ft, idx_fileversion_ft
  //   keyword_lookup / graph_search (semantic channels) — idx_orgkeyword_ft
  "CREATE FULLTEXT INDEX idx_filenode_ft IF NOT EXISTS FOR (n:FileNode) ON EACH [n.purpose, n.summary, n.relative_path]",
  "CREATE FULLTEXT INDEX idx_fileversion_ft IF NOT EXISTS FOR (n:FileVersion) ON EACH [n.purpose, n.summary, n.relative_path]",
  "CREATE FULLTEXT INDEX idx_orgkeyword_ft IF NOT EXISTS FOR (n:OrgKeyword) ON EACH [n.keyword, n.type]",
];

export async function ensureFlatFolderIndexes(): Promise<void> {
  for (const cypher of [...CONSTRAINTS, ...FULLTEXT_INDEXES]) {
    try {
      await _runCypher(cypher);
    } catch (cause: unknown) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (msg.includes("already exists") || msg.includes("EquivalentSchemaRuleAlreadyExists")) {
        process.stderr.write(`[neo4j] flat-folder schema already present, skipping: ${cypher.slice(0, 60)}…\n`);
        continue;
      }
      throw cause;
    }
  }
}
