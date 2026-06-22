import { logger } from "@bb/logger";
import type { AskLlmOptions } from "@bb/llm";
import type { CondensedFileAnalysis } from "@bb/ingest-core";
import type { MetaPaths } from "@bb/ingest-core";
import type { ConcurrencyLimiter } from "@bb/ingest-core";
import type { FileAnalysisCache } from "@bb/ingest-core";
import { dispatchFolderSummaries, groupByDirectFolder } from "#src/flat-folder/folder-summary.ts";

export interface SelectiveFolderSummaryInput {
  knowledgeId: string;
  metaPaths: MetaPaths;
  cache: FileAnalysisCache;
  limiter: ConcurrencyLimiter;
  affectedFolders: Set<string>;
  llmCallContext?: AskLlmOptions;
}

export interface SelectiveFolderSummaryResult {
  succeeded: number;
  failed: number;
  skipped: number;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
  cachedTokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Pull-time folder summary. Same machinery as `runFolderSummaryPhase` but
 * only regenerates folders the caller flagged as affected. Filters by
 * `affectedFolders` BEFORE batching so skipped folders never enter a batch.
 */
export async function runSelectiveFolderSummary(
  input: SelectiveFolderSummaryInput,
): Promise<SelectiveFolderSummaryResult> {
  const allGroups = groupByDirectFolder(input.cache);
  const affectedGroups = new Map<string, CondensedFileAnalysis[]>();
  let skipped = 0;
  for (const [folderPath, files] of allGroups.entries()) {
    if (input.affectedFolders.has(folderPath)) {
      affectedGroups.set(folderPath, files);
    } else {
      skipped += 1;
    }
  }

  const totals = await dispatchFolderSummaries(
    affectedGroups,
    input.metaPaths,
    input.limiter,
    input.llmCallContext,
    undefined,
    input.knowledgeId,
    "pull-folder-summary",
  );
  logger.info(`pull-folder-summary done: succeeded=${totals.succeeded} failed=${totals.failed} skipped=${skipped}`);
  return {
    succeeded: totals.succeeded,
    failed: totals.failed,
    skipped,
    tokenUsage: { inputTokens: totals.inputTokens, outputTokens: totals.outputTokens, costUsd: totals.costUsd },
    cachedTokenUsage: {
      inputTokens: totals.cachedInputTokens,
      outputTokens: totals.cachedOutputTokens,
      costUsd: totals.cachedCostUsd,
    },
  };
}
