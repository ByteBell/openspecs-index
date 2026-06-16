import path from "node:path";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { logger } from "@bb/logger";
import type { AskLlmOptions } from "@bb/llm";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { BigFileEntry } from "#src/types/big-file.ts";
import type { SkipDecider, SourceReader } from "#src/types/pipeline.ts";
import { buildEffectiveIgnoreSets, type EffectiveIgnoreSets } from "#src/pipeline/skip-decisions/effective.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import type { ConcurrencyLimiter } from "#src/pipeline/concurrency.ts";
import { throwIfCancelled } from "#src/pipeline/cancellation.ts";
import { makeSkipDecider } from "#src/pipeline/skip-decisions/index.ts";
import { classifyByTokens, writeBigFiles } from "#src/big-file/detector.ts";
import { emptyManifest, writeScanManifest, type ScanManifest, type ScanManifestEntry } from "#src/scan-manifest.ts";

export interface ScanAndClassifyInput {
  knowledgeId: string;
  source: SourceReader;
  metaPaths: MetaPaths;
  skipDecider?: SkipDecider;
  llmCallContext?: AskLlmOptions;
  progressContext?: ProgressContext;
  /**
   * Shared LLM-concurrency limiter. When supplied the underlying
   * `scanRepository` runs its two-pass strategy: walk + cache-only decisions
   * first, then parallel-deduplicated LLM resolution for unknown
   * extensions/filenames under this limiter. Optional so the function
   * still works standalone.
   */
  limiter?: ConcurrencyLimiter;
  /**
   * Per-job effective ignore sets. Forwarded to the skip-decider (so static
   * filename/extension/glob checks honour the org's overrides) and to the
   * directory-walk pruning inside `scanRepository`. Absent → seed defaults.
   */
  ignoreSets?: EffectiveIgnoreSets;
}

export interface ScanAndClassifyResult {
  manifest: ScanManifest;
}

/**
 * Walks the repo once, classifies every eligible file as small / big /
 * oversized by token count, and writes `scan-manifest.json`. The downstream
 * small-file and big-file phases consume the manifest instead of re-walking.
 *
 * Also writes the legacy `bigFiles.json` so the pull-path and backfill phases
 * (which still read it directly) keep working without migration.
 */
export async function scanAndClassify(input: ScanAndClassifyInput): Promise<ScanAndClassifyResult> {
  const contextWindowLimit = getConfigValue(Config.ContextWindowLimit);
  const maxTokensPerChunk = getConfigValue(Config.MaxTokensPerChunk);
  const manifest = emptyManifest();
  const bigFileEntries: BigFileEntry[] = [];

  const repositoryHint =
    input.source.localRepoDir.length > 0 ? path.basename(input.source.localRepoDir) : input.knowledgeId;
  // Resolve the effective ignore sets exactly once and thread them everywhere
  // (decider + scan deps below) — never conditionally, so the walk and the
  // decider can't silently diverge from the per-job overrides.
  const ignoreSets = input.ignoreSets ?? buildEffectiveIgnoreSets();
  const skipDecider =
    input.skipDecider ??
    makeSkipDecider({
      repositoryName: repositoryHint,
      ignoreSets,
    });

  const reporter = input.progressContext?.reporter({
    phase: "scan",
    total: { kind: "growing" },
  });
  await reporter?.start();

  try {
    const scanDeps: Parameters<typeof input.source.scan>[0] = { skipDecider, ignoreSets };
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
        const manifestEntry: ScanManifestEntry = {
          relativePath: entry.relativePath,
          absolutePath: entry.absolutePath,
          sizeBytes: entry.sizeBytes,
          tokenCount: 0,
          kind: "oversized",
        };
        manifest.entries.push(manifestEntry);
        manifest.summary.oversizedCount += 1;
        manifest.summary.totalFiles += 1;
        bigFileEntries.push({
          relativePath: entry.relativePath,
          sizeBytes: entry.sizeBytes,
          tokenCount: 0,
          reason: "too-large",
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
        bigFileEntries.push({
          relativePath: entry.relativePath,
          sizeBytes: entry.sizeBytes,
          tokenCount,
          reason: "context-window-exceeded",
        });
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
  await writeBigFiles(input.metaPaths, bigFileEntries);
  logger.info(
    `scan-and-classify done: total=${manifest.summary.totalFiles} small=${manifest.summary.smallCount} big=${manifest.summary.bigCount} oversized=${manifest.summary.oversizedCount} totalTokens=${manifest.summary.totalTokens} estimatedBigChunks=${manifest.summary.estimatedBigChunks}`,
  );
  return { manifest };
}
