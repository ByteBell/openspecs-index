import { logger } from "@bb/logger";
import { loadCachedAnalysis } from "#src/disk/load-cached.ts";
import { sanitizeTitle } from "#src/disk/sanitize-title.ts";
import { saveAnalysis } from "#src/disk/save-analysis.ts";
import { saveOriginalText } from "#src/disk/save-original.ts";
import { BusinessContextAnalysisFailedError } from "#src/errors.ts";
import { analyzeBusinessContextParallel } from "#src/llm/analyze-parallel.ts";
import { collectEnrichmentData } from "#src/llm/enrichment-reader.ts";
import { generateBusinessContextTitle } from "#src/llm/title.ts";
import { assertCommitIndexed } from "#src/strategy/commit-validator.ts";
import { businessContextDir } from "@bb/ingest-core";
import path from "node:path";
import type { BusinessContextInput, BusinessContextLlmOptions, BusinessContextStorageResult } from "#src/types.ts";

export interface ExecuteOptions {
  llmOptions: BusinessContextLlmOptions;
}

/**
 * Main entry point for the BusinessContext disk pipeline. Validates the
 * commit is indexed, reads enrichment, runs the title call + the 3 parallel
 * analysis calls, persists both the original text and the analysis envelope
 * to disk. Neo4j persistence is intentionally separate (`store-graph.ts`) so
 * callers can defer it.
 */
export async function executeBusinessContextStrategy(
  input: BusinessContextInput,
  options: ExecuteOptions,
): Promise<BusinessContextStorageResult> {
  logger.info(
    `business-context: executing — knowledge=${input.knowledgeId}, commit=${input.commitHash.substring(0, 12)}, text=${input.text.length} chars`,
  );

  // 1. Validate the commit (or knowledge) is indexed.
  await assertCommitIndexed(input.knowledgeId, input.commitHash);

  // 2. Generate the title.
  const titleResult = await generateBusinessContextTitle(input.text, options.llmOptions);
  const sanitizedTitle = sanitizeTitle(titleResult.title);
  if (sanitizedTitle.length === 0) {
    // Defensive: an empty slug would collide on every BC. Bail with a stable fallback.
    logger.warn(`business-context: sanitized title was empty for "${titleResult.title}" — using fallback slug`);
  }
  const effectiveSlug = sanitizedTitle.length > 0 ? sanitizedTitle : "untitled-business-context";

  // 3. Cache hit? Skip the analysis call and return the existing paths.
  const cached = await loadCachedAnalysis(input.knowledgeId, input.commitHash, effectiveSlug);
  if (cached !== null) {
    const dir = await businessContextDir(input.knowledgeId, input.commitHash, effectiveSlug);
    return {
      analysisPath: path.join(dir, "analysis.json"),
      originalTextPath: path.join(dir, "original.txt"),
      title: cached.analysis.title,
      commitHash: input.commitHash,
      sanitizedTitle: effectiveSlug,
    };
  }

  // 4. Collect enrichment + run the parallel analysis.
  const enrichment = await collectEnrichmentData(input.knowledgeId, input.orgId);
  const analysisResult = await analyzeBusinessContextParallel(
    input.text,
    titleResult.title,
    enrichment,
    options.llmOptions,
  );
  if (analysisResult.analysis === null) {
    throw new BusinessContextAnalysisFailedError(input.knowledgeId, input.commitHash);
  }

  // 5. Persist to disk in parallel.
  const totalInputTokens = titleResult.inputTokens + analysisResult.inputTokens;
  const totalOutputTokens = titleResult.outputTokens + analysisResult.outputTokens;
  const [originalTextPath, analysisPath] = await Promise.all([
    saveOriginalText(input.knowledgeId, input.commitHash, effectiveSlug, input.text),
    saveAnalysis(input.knowledgeId, input.commitHash, effectiveSlug, analysisResult.analysis, {
      commitHash: input.commitHash,
      modelName: analysisResult.modelName,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      ...(input.description !== undefined ? { description: input.description } : {}),
    }),
  ]);

  logger.info(
    `business-context: strategy complete — title="${analysisResult.analysis.title}", commit=${input.commitHash.substring(0, 12)}`,
  );

  return {
    analysisPath,
    originalTextPath,
    title: analysisResult.analysis.title,
    commitHash: input.commitHash,
    sanitizedTitle: effectiveSlug,
  };
}
