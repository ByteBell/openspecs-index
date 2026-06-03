/**
 * IR phase 2d — analyse every big-file chunk with the same file-analysis call small files use,
 * and persist each chunk's result as-is under `chunk-1.json`, `chunk-2.json`, … (1-indexed) in
 * the chunk directory for its parent file. Every chunk record carries the parent file's
 * `relativePath` — chunks of one big file all share that path. The IR strategy does NOT roll
 * chunks up into a per-file manifest.
 *
 * Inputs are read from disk: the scan manifest tells which files are big; per-file raw chunks
 * (written by the cut phase) supply each chunk's content. Re-runs skip chunks whose analysed
 * record already exists on disk.
 */
import { createHash } from "node:crypto";
import { logger } from "@bb/logger";
import { type AskLlmOptions } from "@bb/llm";
import { LlmConfigError } from "@bb/errors";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import { runInPool } from "#src/pipeline/concurrency.ts";
import { throwIfCancelled, CancellationError } from "#src/pipeline/cancellation.ts";
import { languageFromPath } from "#src/adapters/llm-file-analyzer.ts";
import { readScanManifest } from "#src/strategies/flat-folder/scan-manifest.ts";
import { analyseFile } from "#src/strategies/intermediate-representation/file-analysis/analyse-file.ts";
import { addUsage, ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type {
  IrBigFileChunkRaw,
  IrFileAnalysisRecord,
} from "#src/strategies/intermediate-representation/records.ts";
import {
  listRawChunkNumbers,
  readAnalysedChunkIfPresent,
  readRawChunk,
  saveAnalysedChunk,
} from "#src/strategies/intermediate-representation/storage.ts";

export interface AnalyseBigChunksInput {
  knowledgeId: string;
  metaPaths: MetaPaths;
  /** Max number of chunks analysed in parallel (across all big files). */
  concurrency: number;
  llmCallContext?: AskLlmOptions;
  progressContext?: ProgressContext;
}

export interface AnalyseBigChunksResult {
  analysed: number;
  cached: number;
  failed: number;
  tokenUsage: TokenUsage;
}

interface PendingChunk {
  relativePath: string;
  chunkNumber: number;
  raw: IrBigFileChunkRaw;
}

export async function analyseBigChunks(input: AnalyseBigChunksInput): Promise<AnalyseBigChunksResult> {
  const manifest = await readScanManifest(input.metaPaths);
  if (manifest === null) {
    throw new Error(`ir/analyse-big-chunks: scan manifest missing at ${input.metaPaths.scanManifestJson}`);
  }
  const bigEntries = manifest.entries.filter((e) => e.kind === "big");

  // Per-file: load every raw chunk into a flat work list. Files with no raw chunks (cut phase
  // didn't run) are skipped with a warning.
  const work: PendingChunk[] = [];
  for (const entry of bigEntries) {
    throwIfCancelled(input.knowledgeId);
    const numbers = await listRawChunkNumbers(input.metaPaths, entry.relativePath);
    if (numbers.length === 0) {
      logger.warn(`ir/analyse-big-chunks: no raw chunks for ${entry.relativePath}; run cut-big-files first`);
      continue;
    }
    for (const chunkNumber of numbers) {
      const raw = await readRawChunk(input.metaPaths, entry.relativePath, chunkNumber);
      if (raw !== null) {
        work.push({ relativePath: entry.relativePath, chunkNumber, raw });
      }
    }
  }

  let analysed = 0;
  let cached = 0;
  let failed = 0;
  let totalUsage = ZERO_USAGE;

  const reporter = input.progressContext?.reporter({
    phase: "file_analysis",
    subPhase: "ir_analyse_big_chunks",
    total: { kind: "fixed", total: work.length },
  });
  await reporter?.start();

  try {
    await runInPool(input.concurrency, work, async ({ relativePath, chunkNumber, raw }) => {
      throwIfCancelled(input.knowledgeId);
      const tag = `${relativePath}#chunk-${String(chunkNumber)}`;
      try {
        const existing = await readAnalysedChunkIfPresent(input.metaPaths, relativePath, chunkNumber);
        if (existing !== null) {
          cached += 1;
          totalUsage = addUsage(totalUsage, existing.tokenUsage);
          reporter?.increment(1, { fileName: tag });
          return;
        }
        const language = languageFromPath(relativePath);
        const fileNodeId = `${relativePath}:chunk-${String(chunkNumber)}`;
        const analyseInput: Parameters<typeof analyseFile>[0] = {
          language,
          relativePath,
          fileNodeId,
          source: raw.content,
        };
        if (input.llmCallContext !== undefined) {
          analyseInput.llmCallContext = input.llmCallContext;
        }
        const { split: analysis, tokenUsage, model } = await analyseFile(analyseInput);
        const record: IrFileAnalysisRecord = {
          relativePath,
          language: analysis.module.language.length > 0 ? analysis.module.language : language,
          sha256: sha256(raw.content),
          sizeBytes: Buffer.byteLength(raw.content, "utf8"),
          tokenCount: raw.tokenCount,
          analysedAt: new Date().toISOString(),
          analysis,
          tokenUsage,
          model,
        };
        await saveAnalysedChunk(input.metaPaths, relativePath, chunkNumber, record);
        analysed += 1;
        totalUsage = addUsage(totalUsage, tokenUsage);
        reporter?.increment(1, {
          fileName: tag,
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          costUsd: tokenUsage.costUsd,
          model,
        });
      } catch (cause: unknown) {
        if (cause instanceof CancellationError) {
          throw cause;
        }
        if (cause instanceof LlmConfigError) {
          throw cause;
        }
        failed += 1;
        logger.warn(`ir/analyse-big-chunks: ${tag} failed: ${describe(cause)}`);
        reporter?.increment(1, { fileName: tag });
      }
    });
  } finally {
    reporter?.stop();
  }

  logger.info(
    `ir/analyse-big-chunks done: analysed=${analysed} cached=${cached} failed=${failed} totalChunks=${work.length}`,
  );
  return { analysed, cached, failed, tokenUsage: totalUsage };
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
