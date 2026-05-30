/**
 * IR phase 2c — cut every big file at its declaration boundaries. Reads the scan manifest +
 * per-file boundaries from disk, runs `chunkByDeclarations` (pure, no LLM), and persists every
 * raw chunk under `bigFileChunksDir/<encoded>/chunk-N.raw.json`. The chunk-analysis phase reads
 * these raw chunks and SPLITs each one.
 *
 * Skipping rule: a file is considered already cut when its boundaries are present AND at least
 * one raw chunk has already been written. (Boundaries without raw chunks means the previous run
 * crashed between phases — we re-cut from boundaries.)
 */
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { logger } from "@bb/logger";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { SourceReader } from "#src/types/pipeline.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import { runInPool } from "#src/pipeline/concurrency.ts";
import { throwIfCancelled, CancellationError } from "#src/pipeline/cancellation.ts";
import { readScanManifest } from "#src/strategies/flat-folder/scan-manifest.ts";
import { chunkByDeclarations } from "#src/strategies/intermediate-representation/big-file/declarations.ts";
import type { IrBigFileChunkRaw } from "#src/strategies/intermediate-representation/records.ts";
import {
  listRawChunkNumbers,
  readBoundaries,
  saveRawChunk,
} from "#src/strategies/intermediate-representation/storage.ts";

export interface CutBigFilesInput {
  knowledgeId: string;
  source: SourceReader;
  metaPaths: MetaPaths;
  /** Max number of files cut in parallel. Pure CPU/IO — no LLM here. */
  concurrency: number;
  progressContext?: ProgressContext;
}

export interface CutBigFilesResult {
  cut: number;
  cached: number;
  failed: number;
  totalChunks: number;
}

export async function cutBigFiles(input: CutBigFilesInput): Promise<CutBigFilesResult> {
  const manifest = await readScanManifest(input.metaPaths);
  if (manifest === null) {
    throw new Error(`ir/cut-big-files: scan manifest missing at ${input.metaPaths.scanManifestJson}`);
  }
  const maxTokensPerChunk = getConfigValue(Config.MaxTokensPerChunk);
  const bigEntries = manifest.entries.filter((e) => e.kind === "big");

  let cut = 0;
  let cached = 0;
  let failed = 0;
  let totalChunks = 0;

  const reporter = input.progressContext?.reporter({
    phase: "file_analysis",
    subPhase: "ir_cut_big_files",
    total: { kind: "fixed", total: bigEntries.length },
  });
  await reporter?.start();

  try {
    await runInPool(input.concurrency, bigEntries, async (entry) => {
      throwIfCancelled(input.knowledgeId);
      try {
        const boundaries = await readBoundaries(input.metaPaths, entry.relativePath);
        if (boundaries === null) {
          failed += 1;
          logger.warn(`ir/cut-big-files: boundaries missing for ${entry.relativePath}; run compute-boundaries first`);
          reporter?.increment(1, { fileName: entry.relativePath });
          return;
        }

        const existing = await listRawChunkNumbers(input.metaPaths, entry.relativePath);
        if (existing.length > 0) {
          cached += 1;
          totalChunks += existing.length;
          reporter?.increment(1, { fileName: entry.relativePath });
          return;
        }

        const content = await input.source.readFile(entry.relativePath);
        const chunks = chunkByDeclarations(
          entry.relativePath,
          content,
          boundaries.locatedDeclarations,
          maxTokensPerChunk,
        );
        for (const chunk of chunks) {
          const raw: IrBigFileChunkRaw = {
            relativePath: chunk.relativePath,
            chunkIndex: chunk.chunkIndex,
            totalChunks: chunk.totalChunks,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            tokenCount: chunk.tokenCount,
            content: chunk.content,
          };
          await saveRawChunk(input.metaPaths, raw);
        }
        totalChunks += chunks.length;
        cut += 1;
        logger.info(`ir/cut-big-files: ${entry.relativePath} → ${chunks.length} chunk(s)`);
        reporter?.increment(1, { fileName: entry.relativePath });
      } catch (cause: unknown) {
        if (cause instanceof CancellationError) {
          throw cause;
        }
        failed += 1;
        logger.warn(`ir/cut-big-files: failed for ${entry.relativePath}: ${describe(cause)}`);
        reporter?.increment(1, { fileName: entry.relativePath });
      }
    });
  } finally {
    reporter?.stop();
  }

  logger.info(
    `ir/cut-big-files done: cut=${cut} cached=${cached} failed=${failed} totalChunks=${totalChunks}`,
  );
  return { cut, cached, failed, totalChunks };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
