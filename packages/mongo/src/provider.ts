import { connectMongo, closeMongo, pingMongo } from "./client.ts";
import * as knowledgeRepo from "./knowledge.ts";
import * as knowledgeFailure from "./knowledge-failure.ts";
import * as rawRepo from "./raw.ts";
import * as statsRepo from "./aggregateStats.ts";
import * as activityRepo from "./activity.ts";
import * as usageRepo from "./usage.ts";

import { registerDbProvider } from "@bb/db";
import type { IDocumentDatabaseProvider } from "@bb/db-core";

class MongoDatabaseProvider implements IDocumentDatabaseProvider {
  knowledge = {
    setKnowledgeState: knowledgeRepo.setKnowledgeState,
    setKnowledgeCommit: knowledgeRepo.setKnowledgeCommit,
    setKnowledgeCommitHead: knowledgeRepo.setKnowledgeCommitHead,
    setKnowledgeBranch: knowledgeRepo.setKnowledgeBranch,
    updateKnowledgeProgress: knowledgeRepo.updateKnowledgeProgress,
    upsertKnowledge: knowledgeRepo.upsertKnowledge,
    deleteKnowledge: knowledgeRepo.deleteKnowledge,
    listKnowledge: knowledgeRepo.listKnowledge,
    getKnowledge: knowledgeRepo.getKnowledge,
    markKnowledgeFailed: knowledgeFailure.markKnowledgeFailed,
    markKnowledgeHalted: knowledgeFailure.markKnowledgeHalted,
    promoteHaltedToFailed: knowledgeFailure.promoteHaltedToFailed,
    markKnowledgeCorrupted: knowledgeFailure.markKnowledgeCorrupted,
  };

  raw = {
    upsertRawFile: rawRepo.upsertRawFile,
    listRawFileShas: rawRepo.listRawFileShas,
    deleteRawFiles: rawRepo.deleteRawFiles,
  };

  stats = {
    aggregateStats: statsRepo.aggregateStats,
  };

  activity = {
    recordActivity: activityRepo.recordActivity,
  };

  usage = {
    incrementUsage: usageRepo.incrementUsage,
    getMonthlyUsage: usageRepo.getMonthlyUsage,
    getGlobalUsage: usageRepo.getGlobalUsage,
  };

  async connect(): Promise<void> {
    await connectMongo();
  }

  async close(): Promise<void> {
    await closeMongo();
  }

  async ping() {
    return pingMongo();
  }
}

registerDbProvider("mongo", () => new MongoDatabaseProvider());
