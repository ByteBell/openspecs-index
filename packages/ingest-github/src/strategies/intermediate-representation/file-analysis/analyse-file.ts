/**
 * The file-analysis phase (one LLM call per file). Hands the whole file to the model and shapes
 * the response into a {@link FileAnalysisResult}: file-level analysis + module IR + the list of
 * code units. On unparseable / failed responses it degrades to an empty result rather than
 * throwing, except for LLM-config / transport errors which bubble up so the runner can mark the
 * job FAILED.
 */
import { askJsonLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { ZERO_USAGE } from "#src/strategies/intermediate-representation/parse.ts";
import { parseFileAnalysisResult } from "#src/strategies/intermediate-representation/file-analysis/parse/file-analysis.ts";
import type { AnalyseFileResult } from "#src/strategies/intermediate-representation/file-analysis/types/results.ts";
import {
  FILE_ANALYSIS_SYSTEM_PROMPT,
  buildFileAnalysisUserPrompt,
} from "#src/strategies/intermediate-representation/file-analysis/prompts/file-analysis.ts";
import { usageOf } from "#src/strategies/intermediate-representation/usage.ts";

/** Input to the file-analysis phase. */
export interface AnalyseFileInput {
  language: string;
  relativePath: string;
  fileNodeId: string;
  source: string;
  llmCallContext?: AskLlmOptions;
}

/**
 * Runs the file-analysis phase for one file.
 *
 * @param input - The file's language, path, node id, source, and optional LLM call context.
 * @returns The shaped {@link FileAnalysisResult} plus the call's token usage.
 */
export async function analyseFile(input: AnalyseFileInput): Promise<AnalyseFileResult> {
  const userPrompt = buildFileAnalysisUserPrompt({
    language: input.language,
    relativePath: input.relativePath,
    fileNodeId: input.fileNodeId,
    source: input.source,
  });
  try {
    const response = await askJsonLLM<Record<string, unknown>>(
      FILE_ANALYSIS_SYSTEM_PROMPT,
      userPrompt,
      input.llmCallContext ?? {},
    );
    if (response.result === null) {
      logger.warn(`analyseFile: ${input.relativePath} returned unparseable JSON`);
      return {
        split: parseFileAnalysisResult({}, input.fileNodeId, input.source),
        tokenUsage: usageOf(response.usage),
        model: response.usage.model,
      };
    }
    return {
      split: parseFileAnalysisResult(response.result, input.fileNodeId, input.source),
      tokenUsage: usageOf(response.usage),
      model: response.usage.model,
    };
  } catch (cause: unknown) {
    if (cause instanceof LlmConfigError || cause instanceof LlmError) {
      throw cause;
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`analyseFile: ${input.relativePath} askJsonLLM failed: ${msg}`);
    return {
      split: parseFileAnalysisResult({}, input.fileNodeId, input.source),
      tokenUsage: ZERO_USAGE,
      model: "",
    };
  }
}
