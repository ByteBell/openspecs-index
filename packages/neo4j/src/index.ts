import "./provider.ts";

export { connectNeo4j, closeNeo4j, pingNeo4j } from "./client.ts";
export { _runCypher as runCypher, toNeo4jInt } from "./client.ts";
export type { PingResult } from "./client.ts";

export { ensureKnowledgeIndexes } from "./indexes.ts";
export { ensureFlatFolderIndexes } from "./flatFolderIndexes.ts";
export { ensureConceptGraphIndexes } from "./conceptGraphIndexes.ts";

export {
  upsertKnowledgeNode,
  setKnowledgeStateInGraph,
  setKnowledgeBranchInGraph,
  deleteKnowledgeGraph,
} from "./knowledge.ts";

export { upsertFileNode, upsertFileNodesBatch, deleteFileNodes } from "./files.ts";
export type { UpsertFileNodeInput } from "./files.ts";

export { upsertRepoNode } from "./repo.ts";
export type { NodeScope, RepoSummaryPayload, UpsertRepoNodeInput } from "./repo.ts";

export { upsertFolderNode, upsertFolderNodesBatch } from "./folder.ts";
export type { FolderSummaryPayload, UpsertFolderNodeInput } from "./folder.ts";

export { snapshotFilesToVersion } from "./fileVersions.ts";
export type { SnapshotFilesInput } from "./fileVersions.ts";

export { upsertConcept, attachFileToConcept, upsertTestsEdge } from "./concepts.ts";
export { upsertContract, attachFileToContract } from "./contracts.ts";
export { upsertGuidepost, attachGuidepost } from "./guideposts.ts";

// Legacy snake_case mirror — feeds the chat-mcp reader. The primary :Repo /
// :Folder / :File / :FileVersion writers also write :RepoSummary /
// :FolderNode / :FileNode / (FileVersion snake props) and the OrgKeyword
// search graph atomically per upsert; the helpers below are for one-off
// recounts at the end of an ingestion run.
export {
  recomputeOrgKeywordCountersForKnowledge,
  recomputeOrgKeywordCountersForOrg,
} from "./legacyOrgKeywordMirror.ts";
