import { readFile } from "node:fs/promises";
import path from "node:path";
import { businessContextDir } from "@bb/ingest-core";
import { logger } from "@bb/logger";
import type { BusinessContextAnalysisMetadata } from "#src/types.ts";

/**
 * Returns a previously-saved analysis envelope if one exists for this title,
 * otherwise `null`. The cache key is the sanitized title — same title across
 * re-runs returns the same envelope and skips a fresh LLM call.
 *
 * Tolerant of missing or malformed files: the strategy treats `null` as a
 * cache miss and proceeds with a full LLM run. We never crash on stale JSON.
 */
export async function loadCachedAnalysis(
  knowledgeId: string,
  commitHash: string,
  sanitizedTitle: string,
): Promise<BusinessContextAnalysisMetadata | null> {
  const filePath = path.join(await businessContextDir(knowledgeId, commitHash, sanitizedTitle), "analysis.json");
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as BusinessContextAnalysisMetadata;
    if (parsed.analysis === undefined || parsed.analysis === null) {
      logger.warn(`business-context: cached envelope at ${filePath} has no analysis field; ignoring`);
      return null;
    }
    logger.info(
      `business-context: cache HIT at ${filePath} (generated ${parsed.generatedAt}, model ${parsed.modelName})`,
    );
    return parsed;
  } catch (err) {
    logger.warn(`business-context: failed to parse cached analysis ${filePath}: ${(err as Error).message}`);
    return null;
  }
}
