import { KnowledgeState } from "@bb/types";
import type {
  KnowledgeDoc,
  KnowledgeFailureCategory,
  StatsResponse,
  ActivityInput,
  FileAnalysisSection,
  FileAnalysis,
  RawFileDoc,
  KnowledgeListEntry,
  DeleteKnowledgeResult,
  DbPingResult,
} from "@bb/types";

export type { FileAnalysisSection, FileAnalysis, RawFileDoc, KnowledgeListEntry, DeleteKnowledgeResult, DbPingResult };

/** Optional phase metadata persisted alongside file counts by `updateKnowledgeProgress`. */
export interface KnowledgeProgressExtra {
  /** Phase-weighted overall progress (0–100). */
  progressPercent?: number;
  /** Name of the phase currently executing. */
  currentPhase?: string;
}

export interface IKnowledgeRepository {
  setKnowledgeState(knowledgeId: string, state: KnowledgeState): Promise<void>;
  /**
   * Sets `source.commitId` on the knowledge doc without touching the
   * `source.commitHashes` history array. Called early in the pipeline (after
   * the clone resolves a SHA, before the strategy executes) so MCP tools
   * invoked during enrichment can resolve the on-disk clone dir via the
   * commit-scoped path layout. The history entry (with real token usage) is
   * appended later by `setKnowledgeCommit`.
   */
  setKnowledgeCommitHead(knowledgeId: string, commitHash: string): Promise<void>;
  setKnowledgeCommit(
    knowledgeId: string,
    commitHash: string,
    inputTokens?: string,
    outputTokens?: string,
    costUsd?: string,
  ): Promise<void>;
  setKnowledgeBranch(knowledgeId: string, branch: string): Promise<void>;
  updateKnowledgeProgress(
    knowledgeId: string,
    processedFiles: number,
    totalFiles?: number,
    extra?: KnowledgeProgressExtra,
  ): Promise<void>;
  upsertKnowledge(doc: Omit<KnowledgeDoc, "updatedAt"> & { updatedAt?: Date }): Promise<void>;
  deleteKnowledge(knowledgeId: string): Promise<DeleteKnowledgeResult>;
  listKnowledge(opts?: { limit?: number }): Promise<KnowledgeListEntry[]>;
  getKnowledge(knowledgeId: string): Promise<KnowledgeListEntry | null>;
  markKnowledgeFailed(
    knowledgeId: string,
    reason: string,
    category: KnowledgeFailureCategory,
    detail?: string,
  ): Promise<void>;
}

export interface IRawRepository {
  upsertRawFile(doc: Omit<RawFileDoc, "updatedAt">): Promise<void>;
  listRawFileShas(knowledgeId: string): Promise<Map<string, string>>;
  deleteRawFiles(knowledgeId: string, relativePaths: string[]): Promise<number>;
}

export interface IAggregateStatsRepository {
  aggregateStats(): Promise<StatsResponse>;
}

export interface IActivityRepository {
  recordActivity(activity: ActivityInput): Promise<void>;
}

export interface IUsageRepository {
  incrementUsage(identityId: string, inputTokenCount?: number, outputTokenCount?: number): Promise<void>;
  getMonthlyUsage(year: number, month: number): Promise<unknown[]>;
  getGlobalUsage(): Promise<unknown[]>;
}

export interface IDocumentDatabaseProvider {
  knowledge: IKnowledgeRepository;
  raw: IRawRepository;
  stats: IAggregateStatsRepository;
  activity: IActivityRepository;
  usage: IUsageRepository;

  connect(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<DbPingResult>;
}
