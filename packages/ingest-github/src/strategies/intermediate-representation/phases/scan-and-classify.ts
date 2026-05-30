/**
 * IR phase 1 — scan + classify. Walks the repo once and classifies every eligible file as
 * `small` / `big` / `oversized` by token count, writing the result to `scan-manifest.json`. The
 * downstream IR phases consume the manifest instead of re-walking.
 *
 * Mirrors flat-folder's `scanAndClassify` structurally (same `ScanManifest` shape and on-disk
 * location) so the two strategies share `MetaPaths` without contradiction. IR does not need the
 * legacy `bigFiles.json`, so it is not written here.
 */
import path from "node:path";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { logger } from "@bb/logger";
import type { AskLlmOptions } from "@bb/llm";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { SkipDecider, SourceReader } from "#src/types/pipeline.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import type { ConcurrencyLimiter } from "#src/pipeline/concurrency.ts";
import { throwIfCancelled } from "#src/pipeline/cancellation.ts";
import { makeSkipDecider } from "#src/pipeline/skip-decisions/index.ts";
import { classifyByTokens } from "#src/strategies/flat-folder/big-file/detector.ts";
import {
  emptyManifest,
  writeScanManifest,
  type ScanManifest,
  type ScanManifestEntry,
} from "#src/strategies/flat-folder/scan-manifest.ts";

export interface ScanAndClassifyInput {
  knowledgeId: string;
  source: SourceReader;
  metaPaths: MetaPaths;
  skipDecider?: SkipDecider;
  llmCallContext?: AskLlmOptions;
  progressContext?: ProgressContext;
  limiter?: ConcurrencyLimiter;
}

export interface ScanAndClassifyResult {
  manifest: ScanManifest;
}

export async function scanAndClassify(input: ScanAndClassifyInput): Promise<ScanAndClassifyResult> {
  const contextWindowLimit = getConfigValue(Config.ContextWindowLimit);
  const maxTokensPerChunk = getConfigValue(Config.MaxTokensPerChunk);
  const manifest = emptyManifest();

  const repositoryHint =
    input.source.localRepoDir.length > 0 ? path.basename(input.source.localRepoDir) : input.knowledgeId;
  const skipDecider = input.skipDecider ?? makeSkipDecider({ repositoryName: repositoryHint });

  const reporter = input.progressContext?.reporter({
    phase: "scan",
    total: { kind: "growing" },
  });
  await reporter?.start();

  try {
    const scanDeps: Parameters<typeof input.source.scan>[0] = { skipDecider };
    if (input.limiter !== undefined) {
      scanDeps.limiter = input.limiter;
    }
    if (input.llmCallContext !== undefined) {
      scanDeps.llmCallContext = input.llmCallContext;
    }

    for await (const entry of input.source.scan(scanDeps)) {
      throwIfCancelled(input.knowledgeId);
      reporter?.incrementSeen();

      if (entry.kind === "oversized") {
        const oversized: ScanManifestEntry = {
          relativePath: entry.relativePath,
          absolutePath: entry.absolutePath,
          sizeBytes: entry.sizeBytes,
          tokenCount: 0,
          kind: "oversized",
        };
        manifest.entries.push(oversized);
        manifest.summary.oversizedCount += 1;
        manifest.summary.totalFiles += 1;
        skipDecider.noteOversized({
          relativePath: entry.relativePath,
          sizeBytes: entry.sizeBytes,
          reason: entry.reason,
        });
        reporter?.increment(1, { fileName: entry.relativePath });
        continue;
      }

      const { tokenCount, isBigFile } = classifyByTokens(entry.content, contextWindowLimit);
      manifest.summary.totalFiles += 1;
      manifest.summary.totalTokens += tokenCount;
      if (isBigFile) {
        const estimatedChunks = Math.max(1, Math.ceil(tokenCount / maxTokensPerChunk));
        manifest.entries.push({
          relativePath: entry.relativePath,
          absolutePath: entry.absolutePath,
          sizeBytes: entry.sizeBytes,
          tokenCount,
          kind: "big",
          estimatedChunks,
        });
        manifest.summary.bigCount += 1;
        manifest.summary.estimatedBigChunks += estimatedChunks;
      } else {
        manifest.entries.push({
          relativePath: entry.relativePath,
          absolutePath: entry.absolutePath,
          sizeBytes: entry.sizeBytes,
          tokenCount,
          kind: "small",
        });
        manifest.summary.smallCount += 1;
      }
      reporter?.increment(1, { fileName: entry.relativePath });
    }
  } finally {
    reporter?.stop();
  }

  await writeScanManifest(input.metaPaths, manifest);
  logger.info(
    `ir/scan-and-classify done: total=${manifest.summary.totalFiles} small=${manifest.summary.smallCount} big=${manifest.summary.bigCount} oversized=${manifest.summary.oversizedCount} totalTokens=${manifest.summary.totalTokens} estimatedBigChunks=${manifest.summary.estimatedBigChunks}`,
  );
  return { manifest };
}
