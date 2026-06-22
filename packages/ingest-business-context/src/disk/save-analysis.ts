import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { businessContextDir } from "@bb/ingest-core";
import { logger } from "@bb/logger";
import type { BusinessContextAnalysis, BusinessContextAnalysisMetadata } from "#src/types.ts";

const DIR_MODE = 0o700;

export interface SaveAnalysisMetadata {
  commitHash: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  description?: string;
}

/**
 * Wraps the LLM analysis in a metadata envelope (provenance: model, tokens,
 * timestamp) and writes it as `analysis.json` next to `original.txt`. The
 * envelope shape is the cache key — loadCachedAnalysis() reads it back on the
 * next run with the same sanitized title.
 */
export async function saveAnalysis(
  knowledgeId: string,
  commitHash: string,
  sanitizedTitle: string,
  analysis: BusinessContextAnalysis,
  meta: SaveAnalysisMetadata,
): Promise<string> {
  const envelope: BusinessContextAnalysisMetadata = {
    generatedAt: new Date().toISOString(),
    commitHash: meta.commitHash,
    modelName: meta.modelName,
    inputTokens: meta.inputTokens,
    outputTokens: meta.outputTokens,
    ...(meta.description !== undefined ? { description: meta.description } : {}),
    analysis,
  };

  const dir = await businessContextDir(knowledgeId, commitHash, sanitizedTitle);
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const filePath = path.join(dir, "analysis.json");
  await writeFile(filePath, JSON.stringify(envelope, null, 2), { encoding: "utf-8", mode: 0o600 });
  logger.info(
    `business-context: saved analysis at ${filePath} (model=${meta.modelName}, ${meta.inputTokens} in / ${meta.outputTokens} out)`,
  );
  return filePath;
}
