import { KnowledgeState } from "@bb/types";
import { knowledgeDb } from "@bb/db";
import { knowledgeGraph } from "@bb/graph-db";
import type { PipelineSummary } from "#src/types/pipeline.ts";

export async function transitionState(knowledgeId: string, state: KnowledgeState): Promise<void> {
  await knowledgeDb.setKnowledgeState(knowledgeId, state);
  await knowledgeGraph.setKnowledgeStateInGraph(knowledgeId, state).catch(() => undefined);
}

export function emptyPullSummary(commitHash: string, baseCommit: string): PipelineSummary {
  return {
    filesAnalyzed: 0,
    foldersSummarised: 0,
    repoSummarised: false,
    graphNodesWritten: 0,
    commitHash,
    tokenUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    cachedTokenUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    noOp: true,
    baseCommit,
  };
}

interface PullTokenTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Advance a knowledge record to a new commit and mark it PROCESSED, recording the
 * per-commit token + cost totals. Wraps `knowledgeDb.setKnowledgeCommit` + the
 * `PROCESSED` transition so an out-of-tree pull driver (the private IR pull) can
 * finalise a successful pull without taking a direct `@bb/db` / `@bb/graph-db`
 * dependency. Mirrors the tail of OSS `runPull` (the non-no-op success path).
 */
export async function recordPullCommit(
  knowledgeId: string,
  commitHash: string,
  tokenUsage: PullTokenTotals,
  cachedTokenUsage: PullTokenTotals,
): Promise<void> {
  await knowledgeDb.setKnowledgeCommit(
    knowledgeId,
    commitHash,
    String(tokenUsage.inputTokens),
    String(tokenUsage.outputTokens),
    String(tokenUsage.costUsd),
    String(cachedTokenUsage.inputTokens),
    String(cachedTokenUsage.outputTokens),
    String(cachedTokenUsage.costUsd),
  );
  await transitionState(knowledgeId, KnowledgeState.Processed);
}
