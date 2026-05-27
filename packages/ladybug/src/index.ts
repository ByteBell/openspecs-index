import "./provider.ts";

export { connectLadybug, closeLadybug, pingLadybug } from "./client.ts";
export { _runCypher as runCypher } from "./client.ts";
export type { PingResult } from "./client.ts";

export { ensureKnowledgeIndexes } from "./indexes.ts";
export { ensureFlatFolderIndexes } from "./flatFolderIndexes.ts";

export {
  upsertKnowledgeNode,
  setKnowledgeStateInGraph,
  setKnowledgeBranchInGraph,
  deleteKnowledgeGraph,
  vacuumOrphanEntities,
} from "./knowledge.ts";

export { upsertFileNode, deleteFileNodes, bulkUpsertFiles } from "./files.ts";
export type { UpsertFileNodeInput } from "./fileSchemas.ts";

export { upsertRepoNode } from "./repo.ts";
export type { NodeScope, RepoSummaryPayload, UpsertRepoNodeInput } from "./repo.ts";

export { upsertFolderNode } from "./folder.ts";
export type { FolderSummaryPayload, UpsertFolderNodeInput } from "./folder.ts";

export { snapshotFilesToVersion } from "./fileVersions.ts";
export type { SnapshotFilesInput } from "./fileVersions.ts";
