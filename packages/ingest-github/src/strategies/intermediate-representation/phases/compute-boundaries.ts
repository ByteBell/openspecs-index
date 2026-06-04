/**
 * IR phase 2b — compute big-file boundaries. Reads the scan manifest from disk, then for every
 * `big` entry: splits the source into token-budget windows, SKIMs each window into a thin
 * outline, and locates each declaration's start line by matching its verbatim signature in the
 * source. The result — {@link IrBigFileBoundaries} — is persisted once per file.
 *
 * Each window's SKIM is one LLM call. Windows of one file run sequentially (their outlines feed
 * into the locator together), but files themselves run in parallel through `runInPool`.
 */
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { logger } from "@bb/logger";
import { tokenLen, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError } from "@bb/errors";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { SourceReader } from "#src/types/pipeline.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import { runInPool } from "#src/pipeline/concurrency.ts";
import { throwIfCancelled, CancellationError } from "#src/pipeline/cancellation.ts";
import { languageFromPath } from "#src/adapters/llm-file-analyzer.ts";
import { readScanManifest } from "#src/strategies/flat-folder/scan-manifest.ts";
import { splitByTokenBudget } from "#src/strategies/intermediate-representation/chunking.ts";
import { skimWindow } from "#src/strategies/intermediate-representation/big-file/skim.ts";
import { locateDeclarations } from "#src/strategies/intermediate-representation/big-file/declarations.ts";
import { addUsage, ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { SkimWindowOutline } from "#src/strategies/intermediate-representation/types.ts";
import type { IrBigFileBoundaries } from "#src/strategies/intermediate-representation/records.ts";
import { saveBoundaries, readBoundaries } from "#src/strategies/intermediate-representation/storage.ts";

export interface ComputeBoundariesInput {
  knowledgeId: string;
  source: SourceReader;
  metaPaths: MetaPaths;
  /** Max number of files whose windows are SKIM'd in parallel. */
  concurrency: number;
  llmCallContext?: AskLlmOptions;
  progressContext?: ProgressContext;
}

export interface ComputeBoundariesResult {
  processed: number;
  cached: number;
  failed: number;
  tokenUsage: TokenUsage;
}

export async function computeBigFileBoundaries(input: ComputeBoundariesInput): Promise<ComputeBoundariesResult> {
  const manifest = await readScanManifest(input.metaPaths);
  if (manifest === null) {
    throw new Error(`ir/compute-boundaries: scan manifest missing at ${input.metaPaths.scanManifestJson}`);
  }
  const maxTokensPerChunk = getConfigValue(Config.MaxTokensPerChunk);
  const bigEntries = manifest.entries.filter((e) => e.kind === "big");

  let processed = 0;
  let cached = 0;
  let failed = 0;
  let totalUsage = ZERO_USAGE;

  const reporter = input.progressContext?.reporter({
    phase: "file_analysis",
    subPhase: "ir_compute_boundaries",
    total: { kind: "fixed", total: bigEntries.length },
  });
  await reporter?.start();

  try {
    await runInPool(input.concurrency, bigEntries, async (entry) => {
      throwIfCancelled(input.knowledgeId);
      try {
        const existing = await readBoundaries(input.metaPaths, entry.relativePath);
        if (existing !== null) {
          cached += 1;
          reporter?.increment(1, { fileName: entry.relativePath });
          return;
        }

        const content = await input.source.readFile(entry.relativePath);
        if (content.length === 0) {
          failed += 1;
          logger.warn(`ir/compute-boundaries: empty content for ${entry.relativePath}`);
          reporter?.increment(1, { fileName: entry.relativePath });
          return;
        }
        const language = languageFromPath(entry.relativePath);

        const windows = splitByTokenBudget(entry.relativePath, content, maxTokensPerChunk);
        logger.debug(`ir/compute-boundaries: ${entry.relativePath} → ${windows.length} window(s)`);

        let usage = ZERO_USAGE;
        const outlines: SkimWindowOutline[] = [];
        for (const window of windows) {
          throwIfCancelled(input.knowledgeId);
          const skimmed = await skimWindow(window, windows.length, input.llmCallContext);
          usage = addUsage(usage, skimmed.tokenUsage);
          outlines.push(skimmed.outline);
        }
        const locatedDeclarations = locateDeclarations(content, outlines);

        const boundaries: IrBigFileBoundaries = {
          relativePath: entry.relativePath,
          language,
          sizeBytes: entry.sizeBytes,
          tokenCount: tokenLen(content),
          generatedAt: new Date().toISOString(),
          skimOutlines: outlines,
          locatedDeclarations,
          skimTokenUsage: usage,
        };
        await saveBoundaries(input.metaPaths, boundaries);
        totalUsage = addUsage(totalUsage, usage);
        processed += 1;
        reporter?.increment(1, {
          fileName: entry.relativePath,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
        });
      } catch (cause: unknown) {
        if (cause instanceof CancellationError) {
          throw cause;
        }
        if (cause instanceof LlmConfigError) {
          throw cause;
        }
        failed += 1;
        logger.warn(`ir/compute-boundaries: failed for ${entry.relativePath}: ${describe(cause)}`);
        reporter?.increment(1, { fileName: entry.relativePath });
      }
    }, { onActiveChange: (n) => reporter?.setActive?.(n) });
  } finally {
    reporter?.stop();
  }

  logger.info(`ir/compute-boundaries done: processed=${processed} cached=${cached} failed=${failed}`);
  return { processed, cached, failed, tokenUsage: totalUsage };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
