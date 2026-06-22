import { logger } from "@bb/logger";
import type { AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { SourceReader } from "#src/types/pipeline.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import { throwIfCancelled, CancellationError } from "#src/pipeline/cancellation.ts";
import { readBigFiles } from "#src/big-file/detector.ts";
import { inspect } from "#src/big-file/cache.ts";
import { readCondensed } from "#src/big-file/storage.ts";
import { processBigFile } from "#src/big-file/index.ts";

export interface ProcessBigFilesInput {
  knowledgeId: string;
  source: SourceReader;
  metaPaths: MetaPaths;
  llmCallContext?: AskLlmOptions;
  progressContext?: ProgressContext;
}

export interface ProcessBigFilesResult {
  processed: number;
  cached: number;
  failed: number;
  skippedOversized: number;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
  /** Subset of `tokenUsage` served from cache / resumed from disk (not billable). */
  cachedTokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Legacy big-file driver. Reads the deprecated `bigFiles.json`, processes
 * each entry serially via `processBigFile` (which internally does
 * chunk-then-condense). Kept for the pull-path (`pipeline/pull.ts`) and any
 * caller that has not migrated to `analyseBigFiles(manifest, …)` yet.
 */
export async function processBigFilesQueue(input: ProcessBigFilesInput): Promise<ProcessBigFilesResult> {
  const entries = await readBigFiles(input.metaPaths);
  let processed = 0;
  let cached = 0;
  let failed = 0;
  let skippedOversized = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let cachedInputTokens = 0;
  let cachedOutputTokens = 0;
  let cachedCostUsd = 0;

  const reporter = input.progressContext?.reporter({
    phase: "file_analysis",
    subPhase: "big_files_queue",
    total: { kind: "fixed", total: entries.length },
  });
  await reporter?.start();

  try {
    for (const entry of entries) {
      throwIfCancelled(input.knowledgeId);
      if (entry.reason === "too-large") {
        skippedOversized += 1;
        reporter?.increment(1, { fileName: entry.relativePath });
        continue;
      }
      const status = await inspect(input.metaPaths, entry.relativePath);
      if (status === "complete") {
        // Already condensed on a prior attempt — count its persisted token cost so
        // the per-run total reflects start→complete, not just post-resume work.
        const resumed = await readCondensed(input.metaPaths, entry.relativePath);
        if (resumed?.tokenUsage) {
          totalInputTokens += resumed.tokenUsage.inputTokens;
          totalOutputTokens += resumed.tokenUsage.outputTokens;
          totalCostUsd += resumed.tokenUsage.costUsd;
          // Resumed from disk → the whole file was cached this run.
          cachedInputTokens += resumed.tokenUsage.inputTokens;
          cachedOutputTokens += resumed.tokenUsage.outputTokens;
          cachedCostUsd += resumed.tokenUsage.costUsd;
        }
        cached += 1;
        reporter?.increment(1, { fileName: entry.relativePath });
        continue;
      }
      let content: string;
      try {
        content = await input.source.readFile(entry.relativePath);
      } catch (cause: unknown) {
        failed += 1;
        logger.warn(`big-files-queue: read failed for ${entry.relativePath}: ${describe(cause)}`);
        reporter?.increment(1, { fileName: entry.relativePath });
        continue;
      }
      if (content.length === 0) {
        failed += 1;
        logger.warn(`big-files-queue: empty content for ${entry.relativePath}; skipping`);
        reporter?.increment(1, { fileName: entry.relativePath });
        continue;
      }
      try {
        const condensed = await processBigFile({
          knowledgeId: input.knowledgeId,
          metaPaths: input.metaPaths,
          relativePath: entry.relativePath,
          content,
          sizeBytes: entry.sizeBytes,
          ...(input.llmCallContext !== undefined ? { llmCallContext: input.llmCallContext } : {}),
          ...(input.progressContext !== undefined ? { progressContext: input.progressContext } : {}),
        });
        processed += 1;
        if (condensed.tokenUsage) {
          totalInputTokens += condensed.tokenUsage.inputTokens;
          totalOutputTokens += condensed.tokenUsage.outputTokens;
          totalCostUsd += condensed.tokenUsage.costUsd;
        }
        if (condensed.cachedTokenUsage) {
          cachedInputTokens += condensed.cachedTokenUsage.inputTokens;
          cachedOutputTokens += condensed.cachedTokenUsage.outputTokens;
          cachedCostUsd += condensed.cachedTokenUsage.costUsd;
        }
      } catch (cause: unknown) {
        if (cause instanceof CancellationError) {
          throw cause;
        }
        if (cause instanceof LlmConfigError || cause instanceof LlmError) {
          throw cause;
        }
        failed += 1;
        logger.warn(`big-files-queue: processBigFile failed for ${entry.relativePath}: ${describe(cause)}`);
      }
      reporter?.increment(1, { fileName: entry.relativePath });
    }
    logger.info(
      `big-files-queue done: processed=${processed} cached=${cached} failed=${failed} skippedOversized=${skippedOversized}`,
    );
    return {
      processed,
      cached,
      failed,
      skippedOversized,
      tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: totalCostUsd },
      cachedTokenUsage: { inputTokens: cachedInputTokens, outputTokens: cachedOutputTokens, costUsd: cachedCostUsd },
    };
  } finally {
    reporter?.stop();
  }
}

export function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
