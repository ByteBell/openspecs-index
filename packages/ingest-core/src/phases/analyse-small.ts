import { logger } from "@bb/logger";
import type { AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import type { ArchiveSink, FileAnalyzer, ScannedFile, SourceReader } from "#src/types/pipeline.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import type { ConcurrencyLimiter } from "#src/pipeline/concurrency.ts";
import { throwIfCancelled, CancellationError } from "#src/pipeline/cancellation.ts";
import { MAX_LLM_ATTEMPTS, retryLlmCall } from "#src/pipeline/retry-llm.ts";
import { analyseScannedFile, buildOversizedStub } from "#src/analyse-file.ts";
import { readCondensed, saveCondensed } from "#src/big-file/storage.ts";
import type { ScanManifest } from "#src/scan-manifest.ts";

export interface AnalyseSmallInput {
  knowledgeId: string;
  manifest: ScanManifest;
  source: SourceReader;
  metaPaths: MetaPaths;
  analyzer: FileAnalyzer;
  limiter: ConcurrencyLimiter;
  archiveSink?: ArchiveSink;
  llmCallContext?: AskLlmOptions;
  progressContext?: ProgressContext;
}

export interface AnalyseSmallResult {
  smallFilesAnalysed: number;
  oversizedStubs: number;
  failed: number;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
  /** Subset of `tokenUsage` served from cache / resumed from disk (not billable). */
  cachedTokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Consumes the `scan-manifest.json` produced by `scanAndClassify` and
 * analyses every `kind: "small"` entry through the shared LLM limiter.
 *
 * Oversized stubs are also written here (they don't go through the LLM but
 * still need a placeholder analysis row on disk so downstream phases see a
 * complete file set).
 */
export async function analyseSmallFiles(input: AnalyseSmallInput): Promise<AnalyseSmallResult> {
  const smallEntries = input.manifest.entries.filter((e) => e.kind === "small");
  const oversizedEntries = input.manifest.entries.filter((e) => e.kind === "oversized");

  let smallFilesAnalysed = 0;
  let oversizedStubs = 0;
  let failed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let cachedInputTokens = 0;
  let cachedOutputTokens = 0;
  let cachedCostUsd = 0;

  const reporter = input.progressContext?.reporter({
    phase: "file_analysis",
    subPhase: "analyse_small",
    total: { kind: "fixed", total: smallEntries.length + oversizedEntries.length },
  });
  await reporter?.start();

  try {
    for (const entry of oversizedEntries) {
      throwIfCancelled(input.knowledgeId);
      try {
        await saveCondensed(input.metaPaths, buildOversizedStub(entry.relativePath, entry.sizeBytes));
        oversizedStubs += 1;
      } catch (cause: unknown) {
        failed += 1;
        logger.warn(`analyse-small: oversized stub write failed for ${entry.relativePath}: ${describe(cause)}`);
      }
      reporter?.increment(1, { fileName: entry.relativePath });
    }

    const pending: Promise<void>[] = [];
    for (const entry of smallEntries) {
      pending.push(
        input.limiter(async () => {
          throwIfCancelled(input.knowledgeId);
          try {
            // Resume guard: if a previous attempt already wrote the condensed
            // JSON for this path, treat it as done. The on-disk file-analysis
            // JSON is the per-file ledger; a retry must not re-burn the LLM.
            const resumed = await readCondensed(input.metaPaths, entry.relativePath);
            if (resumed !== null) {
              // Account for the tokens spent on the prior attempt so the per-run
              // total reflects start→complete cost, not just the work done since
              // resume. The condensed JSON already carries `tokenUsage` (absent
              // only for oversized stubs / merge fallbacks — hence the guard).
              if (resumed.tokenUsage) {
                totalInputTokens += resumed.tokenUsage.inputTokens;
                totalOutputTokens += resumed.tokenUsage.outputTokens;
                totalCostUsd += resumed.tokenUsage.costUsd;
                // Resumed from disk → the whole file was cached this run.
                cachedInputTokens += resumed.tokenUsage.inputTokens;
                cachedOutputTokens += resumed.tokenUsage.outputTokens;
                cachedCostUsd += resumed.tokenUsage.costUsd;
              }
              smallFilesAnalysed += 1;
              reporter?.increment(1, { fileName: entry.relativePath });
              return;
            }
            const content = await input.source.readFile(entry.relativePath);
            const scanned: ScannedFile = {
              kind: "file",
              relativePath: entry.relativePath,
              absolutePath: entry.absolutePath,
              sizeBytes: entry.sizeBytes,
              content,
            };
            const condensed = await retryLlmCall(
              () => analyseScannedFile(input.analyzer, scanned, input.llmCallContext),
              { phase: "analyse-small", unit: entry.relativePath },
            );
            await saveCondensed(input.metaPaths, condensed);
            if (input.archiveSink !== undefined) {
              await input.archiveSink.push({
                knowledgeId: input.knowledgeId,
                relativePath: entry.relativePath,
                content,
              });
            }
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
            smallFilesAnalysed += 1;
            reporter?.increment(1, { fileName: entry.relativePath });
          } catch (cause: unknown) {
            if (cause instanceof CancellationError) {
              throw cause;
            }
            if (cause instanceof LlmConfigError) {
              // Config errors are not transient — fail the whole batch loudly
              // instead of marking the file as a retryable failure.
              throw cause;
            }
            failed += 1;
            logger.warn(`analyse-small: analyse failed for ${entry.relativePath}: ${describe(cause)}`);
            reporter?.increment(1, { fileName: entry.relativePath });
          }
        }),
      );
    }
    await Promise.all(pending);
  } finally {
    reporter?.stop();
  }

  logger.info(
    `analyse-small done: smallFilesAnalysed=${smallFilesAnalysed} oversizedStubs=${oversizedStubs} failed=${failed}`,
  );
  if (failed > 0) {
    throw new LlmError(
      `analyse-small: ${failed} file(s) failed after ${MAX_LLM_ATTEMPTS} attempts each — retry will resume from disk`,
    );
  }
  return {
    smallFilesAnalysed,
    oversizedStubs,
    failed,
    tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: totalCostUsd },
    cachedTokenUsage: { inputTokens: cachedInputTokens, outputTokens: cachedOutputTokens, costUsd: cachedCostUsd },
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
