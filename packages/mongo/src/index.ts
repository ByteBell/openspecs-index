import "./provider.ts";

export { connectMongo, closeMongo, pingMongo, getMongoDb } from "./client.ts";
export type { PingResult } from "./client.ts";

export {
  getKnowledge,
  setKnowledgeCommit,
  setKnowledgeState,
  setKnowledgeBranch,
  updateKnowledgeProgress,
  upsertKnowledge,
  listKnowledge,
  deleteKnowledge,
} from "./knowledge.ts";
export type { KnowledgeListEntry, DeleteKnowledgeResult } from "./knowledge.ts";
export {
  markKnowledgeFailed,
  markKnowledgeHalted,
  markKnowledgeCorrupted,
  promoteHaltedToFailed,
} from "./knowledge-failure.ts";

export { upsertRawFile, listRawFileShas, deleteRawFiles } from "./raw.ts";
export type { FileAnalysis, FileAnalysisSection, RawFileDoc } from "./raw.ts";

export { aggregateStats } from "./aggregateStats.ts";

export { incrementUsage, getMonthlyUsage, getGlobalUsage } from "./usage.ts";
export { recordActivity } from "./activity.ts";

export {
  startEnrichmentRun,
  getCompletedEnrichmentFiles,
  markFileEnriched,
  recordEnrichmentFailure,
  completeEnrichmentRun,
  failEnrichmentRun,
} from "./enrichment.ts";
