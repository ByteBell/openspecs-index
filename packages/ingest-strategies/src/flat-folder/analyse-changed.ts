import path from "node:path";
import { tokenLen, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import type { ArchiveSink, FileAnalyzer, ScannedFile, SourceReader } from "@bb/ingest-core";
import type { MetaPaths } from "@bb/ingest-core";
import type { BigFileEntry } from "@bb/ingest-core";
import type { ProgressContext } from "@bb/ingest-core";
import { looksBinary } from "@bb/ingest-core";
import type { EffectiveIgnoreSets } from "@bb/ingest-core";
import { countLines } from "@bb/ingest-core";
import { withConcurrency } from "@bb/ingest-core";
import { throwIfCancelled, CancellationError } from "@bb/ingest-core";
import type { DiffResult } from "@bb/ingest-core";
import { analyseScannedFile, buildOversizedStub } from "@bb/ingest-core";
import { saveCondensed } from "@bb/ingest-core";
import { readBigFiles, writeBigFiles } from "@bb/ingest-core";
import { describe, isStaticallyIgnored, mergeBigFileEntries } from "#src/flat-folder/analyse-changed-helpers.ts";

export interface AnalyseChangedInput {
  knowledgeId: string;
  source: SourceReader;
  metaPaths: MetaPaths;
  analyzer: FileAnalyzer;
  diff: DiffResult;
  llmCallContext?: AskLlmOptions;
  /** Optional non-fatal archive sink. When set, analysed content is pushed after `saveCondensed`. */
  archiveSink?: ArchiveSink;
  progressContext?: ProgressContext;
  /**
   * Per-job effective ignore sets. The walk-time pruning never runs on diff
   * paths, so the dispatcher re-applies the static directory / filename /
   * extension / glob checks here. REQUIRED — callers with no overrides pass
   * `buildEffectiveIgnoreSets()` (pure seed defaults); there is no silent
   * filename/extension-only fallback.
   */
  ignoreSets: EffectiveIgnoreSets;
}

export interface AnalyseChangedResult {
  smallFilesAnalysed: number;
  bigFilesQueued: number;
  oversizedStubs: number;
  skipped: number;
  failed: number;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
  cachedTokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Pull-time per-file dispatcher. Iterates the changed file set from the
 * diff and runs the same per-file work as `analyseSmallFiles`, but
 * targeted at known paths rather than a tree walk.
 *
 * Reads file content through `input.source` (a `SourceReader`) so the
 * dispatcher works with both the disk-backed reader (OSS default) and
 * any HTTP-backed alternative supplied via the pull factory hook.
 *
 * For added / modified / renamed-to paths: read content, apply static
 * path filters, classify by tokens. Small files run the analyser inline
 * and persist a `CondensedFileAnalysis`. Files above the context window
 * join `bigFiles.json` for the big-file phase. Files above the absolute
 * size cap get an oversized stub.
 *
 * The dispatcher does NOT invoke the skip-decision LLM gate. Pulls
 * re-analyse paths that already passed the gate during the initial
 * index (or paths so new the gate has not seen them yet — for v1 we
 * accept that lag).
 */
export async function analyseChangedFiles(input: AnalyseChangedInput): Promise<AnalyseChangedResult> {
  const contextWindowLimit = getConfigValue(Config.ContextWindowLimit);
  const absoluteCap = getConfigValue(Config.AbsoluteFileSizeCap);
  const bigFileLineThreshold = getConfigValue(Config.BigFileLineThreshold);
  const concurrentWorkers = getConfigValue(Config.ConcurrentWorkers);
  const limit = withConcurrency(concurrentWorkers);

  const newPaths: string[] = [...input.diff.added, ...input.diff.modified, ...input.diff.renamed.map((r) => r.newPath)];
  const seen = new Set<string>();
  const dedupedPaths = newPaths.filter((p) => {
    if (seen.has(p)) {
      return false;
    }
    seen.add(p);
    return true;
  });

  const bigFileBuffer: BigFileEntry[] = [];
  let smallFilesAnalysed = 0;
  let oversizedStubs = 0;
  let skipped = 0;
  let failed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let cachedInputTokens = 0;
  let cachedOutputTokens = 0;
  let cachedCostUsd = 0;

  const pending: Promise<void>[] = [];

  const reporter = input.progressContext?.reporter({
    phase: "file_analysis",
    subPhase: "pull",
    total: { kind: "fixed", total: dedupedPaths.length },
  });
  await reporter?.start();

  try {
    for (const relativePath of dedupedPaths) {
      throwIfCancelled(input.knowledgeId);
      const filename = path.basename(relativePath);
      const ext = path.extname(filename).toLowerCase();
      if (isStaticallyIgnored(relativePath, filename, ext, input.ignoreSets)) {
        skipped += 1;
        reporter?.increment(1, { fileName: relativePath });
        continue;
      }

      let content: string;
      try {
        content = await input.source.readFile(relativePath);
      } catch (cause: unknown) {
        failed += 1;
        logger.warn(`pull-analyse: read failed for ${relativePath}: ${describe(cause)}`);
        reporter?.increment(1, { fileName: relativePath });
        continue;
      }
      if (content.length === 0) {
        skipped += 1;
        reporter?.increment(1, { fileName: relativePath });
        continue;
      }
      const sizeBytes = Buffer.byteLength(content, "utf8");

      if (sizeBytes > absoluteCap) {
        bigFileBuffer.push({
          relativePath,
          sizeBytes,
          tokenCount: 0,
          reason: "too-large",
        });
        try {
          await saveCondensed(input.metaPaths, buildOversizedStub(relativePath, sizeBytes));
          oversizedStubs += 1;
        } catch (cause: unknown) {
          failed += 1;
          logger.warn(`pull-analyse: oversized stub write failed for ${relativePath}: ${describe(cause)}`);
        }
        reporter?.increment(1, { fileName: relativePath });
        continue;
      }

      if (looksBinary(Buffer.from(content, "utf8"))) {
        skipped += 1;
        reporter?.increment(1, { fileName: relativePath });
        continue;
      }
      if (countLines(content) > bigFileLineThreshold) {
        bigFileBuffer.push({
          relativePath,
          sizeBytes,
          tokenCount: 0,
          reason: "too-large",
        });
        try {
          await saveCondensed(input.metaPaths, buildOversizedStub(relativePath, sizeBytes));
          oversizedStubs += 1;
        } catch (cause: unknown) {
          failed += 1;
          logger.warn(`pull-analyse: oversized stub write failed for ${relativePath}: ${describe(cause)}`);
        }
        reporter?.increment(1, { fileName: relativePath });
        continue;
      }

      const tokenCount = tokenLen(content);
      if (tokenCount > contextWindowLimit) {
        bigFileBuffer.push({
          relativePath,
          sizeBytes,
          tokenCount,
          reason: "context-window-exceeded",
        });
        // Big-file path runs in its own phase; this entry leaves the small-loop accounting.
        reporter?.increment(1, { fileName: relativePath });
        continue;
      }

      const scanned: ScannedFile = {
        kind: "file",
        relativePath,
        absolutePath: relativePath,
        sizeBytes,
        content,
      };
      const fileContent = content;
      const filePath = relativePath;
      pending.push(
        limit(async () => {
          try {
            throwIfCancelled(input.knowledgeId);
            const condensed = await analyseScannedFile(input.analyzer, scanned, input.llmCallContext);
            await saveCondensed(input.metaPaths, condensed);
            if (input.archiveSink !== undefined) {
              await input.archiveSink.push({
                knowledgeId: input.knowledgeId,
                relativePath: filePath,
                content: fileContent,
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
          } catch (cause: unknown) {
            if (cause instanceof CancellationError) {
              throw cause;
            }
            if (cause instanceof LlmConfigError || cause instanceof LlmError) {
              throw cause;
            }
            failed += 1;
            logger.warn(`pull-analyse: analyse failed for ${relativePath}: ${describe(cause)}`);
          }
          reporter?.increment(1, { fileName: filePath });
        }),
      );
    }

    await Promise.all(pending);
  } finally {
    reporter?.stop();
  }

  if (bigFileBuffer.length > 0) {
    const existing = await readBigFiles(input.metaPaths);
    const merged = mergeBigFileEntries(existing, bigFileBuffer);
    await writeBigFiles(input.metaPaths, merged);
  }

  logger.info(
    `pull-analyse done: smallFilesAnalysed=${smallFilesAnalysed} bigFilesQueued=${bigFileBuffer.filter((e) => e.reason === "context-window-exceeded").length} oversizedStubs=${oversizedStubs} skipped=${skipped} failed=${failed}`,
  );
  return {
    smallFilesAnalysed,
    bigFilesQueued: bigFileBuffer.filter((e) => e.reason === "context-window-exceeded").length,
    oversizedStubs,
    skipped,
    failed,
    tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: totalCostUsd },
    cachedTokenUsage: { inputTokens: cachedInputTokens, outputTokens: cachedOutputTokens, costUsd: cachedCostUsd },
  };
}
