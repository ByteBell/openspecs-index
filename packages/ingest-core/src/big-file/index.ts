import { createHash } from "node:crypto";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import type { AskLlmOptions } from "@bb/llm";
import { logger } from "@bb/logger";
import type { ChunkAnalysisResult, HugeFileManifest } from "#src/types/big-file.ts";
import type { CondensedFileAnalysis } from "#src/types/condensed-file-analysis.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import { throwIfCancelled } from "#src/pipeline/cancellation.ts";
import { splitFileIntoChunks } from "./chunker.ts";
import { analyzeChunk } from "./chunk-analyzer.ts";
import { condenseChunks } from "./condenser.ts";
import { loadChunkIfPresent, saveChunk, saveCondensed, saveManifest } from "./storage.ts";
import { addUsage } from "#src/types/token-usage.ts";

export interface ProcessBigFileInput {
  knowledgeId: string;
  metaPaths: MetaPaths;
  relativePath: string;
  content: string;
  sizeBytes: number;
  llmCallContext?: AskLlmOptions;
  progressContext?: ProgressContext;
}

export async function processBigFile(input: ProcessBigFileInput): Promise<CondensedFileAnalysis> {
  throwIfCancelled(input.knowledgeId);
  const maxTokensPerChunk = getConfigValue(Config.MaxTokensPerChunk);
  const concurrency = getConfigValue(Config.BigFileConcurrency);
  const chunks = splitFileIntoChunks(input.relativePath, input.content, maxTokensPerChunk);
  logger.info(`processBigFile: ${input.relativePath} split into ${chunks.length} chunks`);

  const results: ChunkAnalysisResult[] = new Array(chunks.length);
  let nextIndex = 0;

  const reporter = input.progressContext?.reporter({
    phase: "file_analysis",
    subPhase: `big_file:${input.relativePath}`,
    total: { kind: "fixed", total: chunks.length },
  });
  await reporter?.start();

  const worker = async (): Promise<void> => {
    while (nextIndex < chunks.length) {
      const idx = nextIndex;
      nextIndex += 1;
      throwIfCancelled(input.knowledgeId);
      const chunk = chunks[idx];
      if (chunk === undefined) {
        continue;
      }
      const cached = await loadChunkIfPresent(input.metaPaths, input.relativePath, idx);
      if (cached !== null) {
        // Loaded from disk → no fresh call this run, so the whole chunk's cost
        // is "cached" for this run regardless of how it was originally produced.
        cached.cachedTokenUsage = cached.tokenUsage;
        results[idx] = cached;
        reporter?.increment(1, { fileName: `${input.relativePath}#chunk-${String(idx)}` });
        continue;
      }
      const analyzed = await analyzeChunk(chunk, input.llmCallContext);
      await saveChunk(input.metaPaths, analyzed);
      results[idx] = analyzed;
      reporter?.increment(1, { fileName: `${input.relativePath}#chunk-${String(idx)}` });
    }
  };

  try {
    const workerCount = Math.min(concurrency, chunks.length);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
  } finally {
    reporter?.stop();
  }

  throwIfCancelled(input.knowledgeId);
  const merged = await condenseChunks(input.relativePath, results, input.llmCallContext);

  const chunkPaths = chunks.map((_, i) => `chunks/${encodeFolder(input.relativePath)}/chunk-${i}.json`);
  const totalTokenCount = chunks.reduce((acc, c) => acc + c.tokenCount, 0);

  const chunkInputTokens = results.reduce((acc, r) => acc + (r.tokenUsage?.inputTokens ?? 0), 0);
  const chunkOutputTokens = results.reduce((acc, r) => acc + (r.tokenUsage?.outputTokens ?? 0), 0);
  const chunkCostUsd = results.reduce((acc, r) => acc + (r.tokenUsage?.costUsd ?? 0), 0);
  const totalInputTokens = chunkInputTokens + (merged.tokenUsage?.inputTokens ?? 0);
  const totalOutputTokens = chunkOutputTokens + (merged.tokenUsage?.outputTokens ?? 0);
  const totalCostUsd = chunkCostUsd + (merged.tokenUsage?.costUsd ?? 0);
  // Cached subset = cached chunks (incl. disk-loaded) + cached condense step.
  const cachedTokenUsage = addUsage(merged.cachedTokenUsage, ...results.map((r) => r.cachedTokenUsage));

  const manifest: HugeFileManifest = {
    relativePath: input.relativePath,
    totalChunks: chunks.length,
    totalTokenCount,
    chunkPaths,
    generatedAt: new Date().toISOString(),
  };
  await saveManifest(input.metaPaths, manifest);

  const condensed: CondensedFileAnalysis = {
    relativePath: input.relativePath,
    language: merged.language,
    sha256: sha256(input.content),
    sizeBytes: input.sizeBytes,
    tokenCount: totalTokenCount,
    isBigFile: true,
    totalChunks: chunks.length,
    totalTokenCount,
    analysedAt: new Date().toISOString(),
    analysis: merged.analysis,
    tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: totalCostUsd },
    cachedTokenUsage,
  };
  await saveCondensed(input.metaPaths, condensed);
  return condensed;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function encodeFolder(relativePath: string): string {
  return relativePath.replace(/\//gu, "__SL__").replace(/\\/gu, "__BS__");
}
