/**
 * IR phase 2a — analyse every `small` entry in the scan manifest with the file-analysis call and
 * persist the resulting {@link IrFileAnalysisRecord}. Mirrors flat-folder's `analyseSmallFiles`
 * structurally; the file-analysis prompt produces the module-level fields plus a verbatim list of
 * code units (with line spans) which the IR strategy stores as-is.
 *
 * Re-runs skip files whose record already exists on disk.
 */
import { createHash } from "node:crypto";
import { tokenLen, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError } from "@bb/errors";
import { logger } from "@bb/logger";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { SourceReader } from "#src/types/pipeline.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import { runInPool } from "#src/pipeline/concurrency.ts";
import { throwIfCancelled, CancellationError } from "#src/pipeline/cancellation.ts";
import { languageFromPath } from "#src/adapters/llm-file-analyzer.ts";
import { readScanManifest } from "#src/strategies/flat-folder/scan-manifest.ts";
import { analyseFile } from "#src/strategies/intermediate-representation/reconstruction/analyzers/analyse-file.ts";
import type { IrFileAnalysisRecord } from "#src/strategies/intermediate-representation/records.ts";
import {
  hasFileAnalysisRecord,
  saveFileAnalysisRecord,
} from "#src/strategies/intermediate-representation/storage.ts";

export interface AnalyseSmallInput {
  knowledgeId: string;
  source: SourceReader;
  metaPaths: MetaPaths;
  /** Max number of files analysed in parallel; each task runs one file-analysis LLM call. */
  concurrency: number;
  llmCallContext?: AskLlmOptions;
  progressContext?: ProgressContext;
}

export interface AnalyseSmallResult {
  analysed: number;
  cached: number;
  failed: number;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}

export async function analyseSmallFiles(input: AnalyseSmallInput): Promise<AnalyseSmallResult> {
  const manifest = await readScanManifest(input.metaPaths);
  if (manifest === null) {
    throw new Error(`ir/analyse-small: scan manifest missing at ${input.metaPaths.scanManifestJson}`);
  }
  const smallEntries = manifest.entries.filter((e) => e.kind === "small");

  // Pre-pass: partition entries into cached (record already on disk) vs pending. Done before
  // the work pool so the progress bar can show the actual workload and the log records exactly
  // which paths are reused. Uses a presence-only check (no JSON parse) so the pass stays cheap
  // even on large manifests.
  const cachedPaths: string[] = [];
  const pendingEntries: typeof smallEntries = [];
  for (const entry of smallEntries) {
    throwIfCancelled(input.knowledgeId);
    if (await hasFileAnalysisRecord(input.metaPaths, entry.relativePath)) {
      cachedPaths.push(entry.relativePath);
    } else {
      pendingEntries.push(entry);
    }
  }

  logger.info(
    `ir/analyse-small starting: total=${smallEntries.length} ` +
      `cached-on-disk=${cachedPaths.length} pending=${pendingEntries.length}`,
  );
  for (const cachedPath of cachedPaths) {
    logger.debug(`ir/analyse-small: CACHED ${cachedPath}`);
  }

  let analysed = 0;
  const cached = cachedPaths.length;
  let failed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  const reporter = input.progressContext?.reporter({
    phase: "file_analysis",
    subPhase: "ir_analyse_small",
    total: { kind: "fixed", total: pendingEntries.length },
  });
  await reporter?.start();

  try {
    await runInPool(input.concurrency, pendingEntries, async (entry) => {
      throwIfCancelled(input.knowledgeId);
      try {
        logger.debug(`ir/analyse-small: ANALYSING ${entry.relativePath}`);
        const content = await input.source.readFile(entry.relativePath);
        const language = languageFromPath(entry.relativePath);
        const fileNodeId = `${input.knowledgeId}:${entry.relativePath}`;
        const analyseInput: Parameters<typeof analyseFile>[0] = {
          language,
          relativePath: entry.relativePath,
          fileNodeId,
          source: content,
        };
        if (input.llmCallContext !== undefined) {
          analyseInput.llmCallContext = input.llmCallContext;
        }
        const { split: analysis, tokenUsage } = await analyseFile(analyseInput);

        const record: IrFileAnalysisRecord = {
          relativePath: entry.relativePath,
          language: analysis.module.language.length > 0 ? analysis.module.language : language,
          sha256: sha256(content),
          sizeBytes: entry.sizeBytes,
          tokenCount: tokenLen(content),
          analysedAt: new Date().toISOString(),
          analysis,
          tokenUsage,
        };
        await saveFileAnalysisRecord(input.metaPaths, record);

        totalInputTokens += tokenUsage.inputTokens;
        totalOutputTokens += tokenUsage.outputTokens;
        totalCostUsd += tokenUsage.costUsd;
        analysed += 1;
        reporter?.increment(1, { fileName: entry.relativePath });
      } catch (cause: unknown) {
        if (cause instanceof CancellationError) {
          throw cause;
        }
        if (cause instanceof LlmConfigError) {
          throw cause;
        }
        failed += 1;
        logger.warn(`ir/analyse-small: failed for ${entry.relativePath}: ${describe(cause)}`);
        reporter?.increment(1, { fileName: entry.relativePath });
      }
    });
  } finally {
    reporter?.stop();
  }

  logger.info(`ir/analyse-small done: analysed=${analysed} cached=${cached} failed=${failed}`);
  return {
    analysed,
    cached,
    failed,
    tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: totalCostUsd },
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
