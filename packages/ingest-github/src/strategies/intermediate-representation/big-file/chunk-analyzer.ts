/**
 * Stage 3 of the IR big-file path — AWARE_CHUNK. Deep-analyses ONE chunk WITH the whole-file map
 * digest injected, so calls / imports defined in other chunks resolve and the chunk is described
 * in the context of the whole file. This is the IR strategy's OWN chunk analyzer — it does NOT
 * borrow flat-folder's context-blind `analyzeChunk`; the IR path owns its chunk analysis end to end.
 *
 * Degrades to an empty result on unparseable / failed responses; LLM config / transport errors bubble up.
 */
import { askJsonLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import type { ChunkAnalysisResult, FileChunk } from "#src/types/big-file.ts";
import { FALLBACK_LANGUAGE, emptyFileAnalysis } from "#src/types/file-analysis.ts";
import { shapeAnalysis } from "#src/adapters/llm-file-analyzer.ts";
import {
  AWARE_CHUNK_SYSTEM_PROMPT,
  buildAwareChunkUserPrompt,
} from "#src/strategies/intermediate-representation/prompts/aware-chunk.ts";

/** The empty chunk result used when an aware-chunk call returns nothing parseable. */
function emptyChunkResult(chunk: FileChunk): ChunkAnalysisResult {
  return {
    relativePath: chunk.relativePath,
    chunkIndex: chunk.chunkIndex,
    totalChunks: chunk.totalChunks,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    language: FALLBACK_LANGUAGE,
    analysis: emptyFileAnalysis(),
  };
}

/**
 * Deep-analyses ONE chunk in the context of the whole file.
 *
 * @param chunk - The chunk to analyse (its line range + content).
 * @param fileMapDigest - The rendered file-map digest (overview + declaration index).
 * @param llmCallContext - Optional LLM call context (model / credentials).
 * @returns The chunk's analysis plus the call's token usage; an empty result on a failed call.
 */
export async function analyzeAwareChunk(
  chunk: FileChunk,
  fileMapDigest: string,
  llmCallContext?: AskLlmOptions,
): Promise<ChunkAnalysisResult> {
  const userPrompt = buildAwareChunkUserPrompt({
    relativePath: chunk.relativePath,
    chunkIndex: chunk.chunkIndex,
    totalChunks: chunk.totalChunks,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    fileMapDigest,
    content: chunk.content,
  });
  try {
    const response = await askJsonLLM<Record<string, unknown>>(AWARE_CHUNK_SYSTEM_PROMPT, userPrompt, llmCallContext ?? {});
    if (response.result === null) {
      logger.warn(`analyzeAwareChunk: ${chunk.relativePath} chunk ${chunk.chunkIndex + 1}/${chunk.totalChunks} unparseable`);
      return emptyChunkResult(chunk);
    }
    const { language, analysis } = shapeAnalysis(response.result);
    return {
      relativePath: chunk.relativePath,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      language,
      analysis,
      tokenUsage: {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costUsd: response.usage.costUsd,
      },
    };
  } catch (cause: unknown) {
    if (cause instanceof LlmConfigError || cause instanceof LlmError) {
      throw cause;
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`analyzeAwareChunk: ${chunk.relativePath} chunk ${chunk.chunkIndex + 1} failed: ${msg}`);
    return emptyChunkResult(chunk);
  }
}
