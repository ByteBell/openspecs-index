import type { AskLlmOptions } from "@bb/llm";
import { logger } from "@bb/logger";
import type { CondensedFileAnalysis } from "#src/types/condensed-file-analysis.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { ConcurrencyLimiter } from "#src/pipeline/concurrency.ts";
import { throwIfCancelled, CancellationError } from "#src/pipeline/cancellation.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import type { FileAnalysisCache } from "./file-analysis-cache.ts";
import { directFolderOf } from "./folder-path.ts";
import {
  type FolderBucket,
  groupFoldersForBatching,
  summariseFolder,
  summariseFolderBatch,
  persistFolderSummary,
} from "./folder-summary-api.ts";

export { iterateFolderSummaries } from "./folder-summary-api.ts";

export function groupByDirectFolder(cache: FileAnalysisCache): Map<string, CondensedFileAnalysis[]> {
  const groups = new Map<string, CondensedFileAnalysis[]>();
  for (const entry of cache.values()) {
    const folder = directFolderOf(entry.relativePath);
    const bucket = groups.get(folder) ?? [];
    bucket.push(entry);
    groups.set(folder, bucket);
  }
  return groups;
}

interface FolderSummaryTotals {
  succeeded: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Dispatches a single folder through `summariseFolder` and persists the
 * result. Shared between `runFolderSummaryPhase` and `runSelectiveFolderSummary`.
 */
async function dispatchIndividual(
  bucket: FolderBucket,
  metaPaths: MetaPaths,
  totals: FolderSummaryTotals,
  llmCallContext: AskLlmOptions | undefined,
  reporter: ReturnType<NonNullable<ProgressContext["reporter"]>> | undefined,
  knowledgeId: string,
  phaseLabel: string,
): Promise<void> {
  try {
    throwIfCancelled(knowledgeId);
    const { summary, tokenUsage } = await summariseFolder(bucket.folderPath, bucket.files, llmCallContext);
    totals.inputTokens += tokenUsage.inputTokens;
    totals.outputTokens += tokenUsage.outputTokens;
    totals.costUsd += tokenUsage.costUsd;
    if (summary !== null) {
      await persistFolderSummary(metaPaths, summary);
      totals.succeeded += 1;
    } else {
      totals.failed += 1;
    }
  } catch (cause: unknown) {
    if (cause instanceof CancellationError) {
      throw cause;
    }
    totals.failed += 1;
    logger.warn(`${phaseLabel}: folder summary failed for ${bucket.folderPath || "<root>"}`);
  } finally {
    reporter?.increment(1, { fileName: bucket.folderPath || "<root>" });
  }
}

/**
 * Dispatches a multi-folder batch through `summariseFolderBatch`. Each
 * non-null per-folder summary is persisted; missing/null entries count
 * toward `failed`. Progress increments once per folder.
 */
async function dispatchBatch(
  batch: FolderBucket[],
  metaPaths: MetaPaths,
  totals: FolderSummaryTotals,
  llmCallContext: AskLlmOptions | undefined,
  reporter: ReturnType<NonNullable<ProgressContext["reporter"]>> | undefined,
  knowledgeId: string,
  phaseLabel: string,
): Promise<void> {
  try {
    throwIfCancelled(knowledgeId);
    const { summaries, tokenUsage } = await summariseFolderBatch(batch, llmCallContext);
    totals.inputTokens += tokenUsage.inputTokens;
    totals.outputTokens += tokenUsage.outputTokens;
    totals.costUsd += tokenUsage.costUsd;
    for (const bucket of batch) {
      const summary = summaries.get(bucket.folderPath) ?? null;
      if (summary !== null) {
        try {
          await persistFolderSummary(metaPaths, summary);
          totals.succeeded += 1;
        } catch (cause: unknown) {
          totals.failed += 1;
          logger.warn(
            `${phaseLabel}: persist failed for ${bucket.folderPath || "<root>"}: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      } else {
        totals.failed += 1;
      }
      reporter?.increment(1, { fileName: bucket.folderPath || "<root>" });
    }
  } catch (cause: unknown) {
    if (cause instanceof CancellationError) {
      throw cause;
    }
    totals.failed += batch.length;
    for (const bucket of batch) {
      reporter?.increment(1, { fileName: bucket.folderPath || "<root>" });
    }
    logger.warn(
      `${phaseLabel}: batch summary failed for ${batch.length} folders: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/**
 * Dispatch helper used by both `runFolderSummaryPhase` and
 * `runSelectiveFolderSummary`. Splits `groups` into individual + batched
 * buckets, schedules every task through the shared `limiter`, awaits all,
 * and returns the aggregated totals.
 */
export async function dispatchFolderSummaries(
  groups: Map<string, CondensedFileAnalysis[]>,
  metaPaths: MetaPaths,
  limiter: ConcurrencyLimiter,
  llmCallContext: AskLlmOptions | undefined,
  reporter: ReturnType<NonNullable<ProgressContext["reporter"]>> | undefined,
  knowledgeId: string,
  phaseLabel: string,
): Promise<FolderSummaryTotals> {
  const totals: FolderSummaryTotals = { succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const { individual, batches } = groupFoldersForBatching(groups);
  const tasks: Promise<void>[] = [];
  for (const bucket of individual) {
    tasks.push(
      limiter(() => dispatchIndividual(bucket, metaPaths, totals, llmCallContext, reporter, knowledgeId, phaseLabel)),
    );
  }
  for (const batch of batches) {
    tasks.push(
      limiter(() => dispatchBatch(batch, metaPaths, totals, llmCallContext, reporter, knowledgeId, phaseLabel)),
    );
  }
  await Promise.all(tasks);
  return totals;
}

export async function runFolderSummaryPhase(
  knowledgeId: string,
  metaPaths: MetaPaths,
  cache: FileAnalysisCache,
  limiter: ConcurrencyLimiter,
  llmCallContext?: AskLlmOptions,
  progressContext?: ProgressContext,
): Promise<{
  succeeded: number;
  failed: number;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}> {
  const groups = groupByDirectFolder(cache);
  const reporter = progressContext?.reporter({
    phase: "folder_analysis",
    total: { kind: "fixed", total: groups.size },
  });
  await reporter?.start();
  let totals: FolderSummaryTotals;
  try {
    totals = await dispatchFolderSummaries(groups, metaPaths, limiter, llmCallContext, reporter, knowledgeId, "phase5");
  } finally {
    reporter?.stop();
  }
  logger.info(`phase5 done: foldersSummarised=${totals.succeeded} failed=${totals.failed}`);
  return {
    succeeded: totals.succeeded,
    failed: totals.failed,
    tokenUsage: { inputTokens: totals.inputTokens, outputTokens: totals.outputTokens, costUsd: totals.costUsd },
  };
}
