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
    noOp: true,
    baseCommit,
  };
}
