/**
 * Stage 1 of the IR big-file path — SKIM. One window of a large file is summarised into a thin
 * structural outline (declarations + imports + a one-line region summary), never a deep analysis.
 * The outlines of every window are later merged into one whole-file map (`file-map.ts`).
 *
 * Degrades to an empty outline on unparseable / failed responses; LLM config / transport errors
 * bubble up so the caller can fail the job.
 */
import { askJsonLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { parseSkimOutline, ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { SkimWindowOutline } from "#src/strategies/intermediate-representation/types.ts";
import { SKIM_SYSTEM_PROMPT, buildSkimUserPrompt } from "#src/strategies/intermediate-representation/prompts/skim.ts";
import { FALLBACK_LANGUAGE } from "#src/types/file-analysis.ts";
import type { FileChunk } from "#src/types/big-file.ts";

/** A skimmed window outline plus the token usage of the call that produced it. */
export interface SkimWindowResult {
  outline: SkimWindowOutline;
  tokenUsage: TokenUsage;
}

/** The empty outline used when a window's skim returns nothing parseable. */
function emptyOutline(window: FileChunk): SkimWindowOutline {
  return {
    startLine: window.startLine,
    endLine: window.endLine,
    language: FALLBACK_LANGUAGE,
    windowSummary: "",
    importsInternal: [],
    importsExternal: [],
    declarations: [],
  };
}

/**
 * Skims ONE window into a {@link SkimWindowOutline}. The window's known line range is stamped onto
 * the outline (the model is not trusted to report it).
 *
 * @param window - The window (a boundary-refined chunk) to skim.
 * @param totalWindows - How many windows the file was cut into (for the prompt's position line).
 * @param llmCallContext - Optional LLM call context (model / credentials).
 * @returns The window outline plus the call's token usage.
 */
export async function skimWindow(
  window: FileChunk,
  totalWindows: number,
  llmCallContext?: AskLlmOptions,
): Promise<SkimWindowResult> {
  const userPrompt = buildSkimUserPrompt({
    relativePath: window.relativePath,
    windowIndex: window.chunkIndex,
    totalWindows,
    startLine: window.startLine,
    endLine: window.endLine,
    content: window.content,
  });
  try {
    const response = await askJsonLLM<Record<string, unknown>>(SKIM_SYSTEM_PROMPT, userPrompt, llmCallContext ?? {});
    const tokenUsage: TokenUsage = {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      costUsd: response.usage.costUsd,
    };
    if (response.result === null) {
      logger.warn(`skimWindow: ${window.relativePath} window ${window.chunkIndex + 1}/${totalWindows} unparseable`);
      return { outline: emptyOutline(window), tokenUsage };
    }
    return { outline: parseSkimOutline(response.result, window.startLine, window.endLine), tokenUsage };
  } catch (cause: unknown) {
    if (cause instanceof LlmConfigError || cause instanceof LlmError) {
      throw cause;
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`skimWindow: ${window.relativePath} window ${window.chunkIndex + 1} failed: ${msg}`);
    return { outline: emptyOutline(window), tokenUsage: ZERO_USAGE };
  }
}
